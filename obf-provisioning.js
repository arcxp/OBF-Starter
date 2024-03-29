const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')
require('dotenv').config()
const { promisify } = require('util')
const { execSync } = require('child_process')
const sleep = promisify(setTimeout)

// PULL ORG INFO
const contentBase = process.env.CONTENT_BASE
const authToken = process.env.ARC_ACCESS_TOKEN
const orgID = fetchOrgID()
const envsToCheck = ['outboundfeeds', 'outboundfeeds-sandbox']
const envs = fetchEnvs()
const zipFileName = `${orgID}-obf-bundle`
const delay = process.env.POLLING_DELAY || 10000
const timeout = process.env.TIMEOUT || 30
let latestServiceVersion = null

function fetchOrgID() {
  if (!contentBase) {
    console.log('No CONTENT_BASE found in .env')
  } else {
    return contentBase.split('.')[contentBase.split('.').length - 3]
  }
}

function fetchEnvs() {
  const envs = []
  if (process.env.OBF_DEPLOYER_ENDPOINT) {
    envs.push('outboundfeeds')
  }
  if (process.env.OBF_SANDBOX_DEPLOYER_ENDPOINT) {
    envs.push('outboundfeeds-sandbox')
  }
  return envs
}

function fetchEnvironmentVariables(env) {
  let baseUrl = ''
  let auth = ''

  if (env === 'outboundfeeds') {
    baseUrl = process.env.OBF_DEPLOYER_ENDPOINT
    auth = process.env.OBF_DEPLOYER_ACCESS_TOKEN
  } else if (env === 'outboundfeeds-sandbox') {
    baseUrl = process.env.OBF_SANDBOX_DEPLOYER_ENDPOINT
    auth = process.env.OBF_SANDBOX_DEPLOYER_ACCESS_TOKEN
  }

  return { baseUrl, auth }
}

// PREPARE THE BUNDLE
async function fetchResizerVersion() {
  console.log('Fetching Resizer Version')

  try {
    if (!contentBase || !authToken) {
      throw new Error(
        'CONTENT_BASE or ARC_ACCESS_TOKEN is not defined in environment variables.',
      )
    }

    const apiUrl = `${contentBase}/delivery-api/v1/organization/hmac-key/resizer?enabled=true`

    const headers = {
      Authorization: `Bearer ${authToken}`,
    }

    const response = await axios.get(apiUrl, { headers })
    const resizerVersion = response.data[0].ssm_version
    console.log(resizerVersion)
    return resizerVersion
  } catch (error) {
    console.error('Error:', error.message)
  }
}

async function updateEnvironment() {
  const resizerVersion = await fetchResizerVersion()
  await Promise.all(
    envsToCheck.map(async (env) => {
      if (envs.includes(env)) {
        const writePath = `environment/${orgID}-${env}.json`
        const blockDistTag = env === 'outboundfeeds' ? 'stable' : 'beta'

        const envContent = {
          BLOCK_DIST_TAG: blockDistTag,
          RESIZER_TOKEN_VERSION: resizerVersion,
          SIGNING_SERVICE_DEFAULT_APP: 'resizer',
        }

        fs.writeFileSync(
          writePath,
          JSON.stringify(envContent, null, 2),
          'utf-8',
        )
        console.log(`${writePath} successfully updated`)
      }
    }),
  )
}

function updateBlocksJSON(data) {
  const sitesObject = {}
  console.log(envs)

  data.forEach((site) => {
    const resizerObject = {}
    if (envs.includes('outboundfeeds')) {
      resizerObject[`${orgID}-outboundfeeds`] =
        `https://${orgID}-${site._id}-prod.web.arc-cdn.net/resizer/v2`
    }
    if (envs.includes('outboundfeeds-sandbox')) {
      resizerObject[`${orgID}-outboundfeeds-sandbox`] =
        `https://${orgID}-${site._id}-sandbox.web.arc-cdn.net/resizer/v2`
    }

    sitesObject[site._id] = {
      siteProperties: {
        feedDomainURL: `https://www.${site._id}.com`,
        resizerURL: `https://${orgID}-${site._id}-prod.web.arc-cdn.net/resizer/v2`,
        resizerURLs: resizerObject,
        feedTitle: site.display_name || site._id,
      },
    }
  })

  const blocksPath = 'blocks.json'
  const blocksJSON = JSON.parse(fs.readFileSync(blocksPath, 'utf-8'))

  const updatedContent = blocksJSON
  updatedContent.values.sites = sitesObject
  fs.writeFileSync(blocksPath, JSON.stringify(updatedContent, null, 2), 'utf-8')
  console.log('blocks.json successfully updated')
}

async function fetchSiteData() {
  try {
    if (!contentBase || !authToken) {
      throw new Error(
        'CONTENT_BASE or ARC_ACCESS_TOKEN is not defined in environment variables.',
      )
    }

    const apiUrl = `${contentBase}/site/v3/website/`

    const options = {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }

    const res = await axios.get(apiUrl, options)
    fs.writeFileSync(
      'mocks/siteservice/api/v3/website',
      JSON.stringify(res.data, null, 2),
      'utf-8',
    )
    updateBlocksJSON(res.data)
  } catch (error) {
    console.error('Error fetching data:', error.message)
  }
}

function addToGitignore() {
  const gitignorePath = '.gitignore'

  fs.readFile(gitignorePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading ${gitignorePath}: ${err.message}`)
      return
    }

    if (data.includes('obf-provisioning.js')) {
      console.log(`File 'obf-provisioning.js' is already in ${gitignorePath}.`)
    } else {
      const updatedContent = data + `\nobf-provisioning.js\n`

      fs.writeFile(gitignorePath, updatedContent, 'utf8', (writeErr) => {
        if (writeErr) {
          console.error(
            `Error writing to ${gitignorePath}: ${writeErr.message}`,
          )
        } else {
          console.log(`Added 'obf-provisioning.js' to ${gitignorePath}.`)
        }
      })
    }
  })
}

// ZIP AND DEPLOY THE BUNDLE
function zipBundle(zipFileName) {
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist')
    console.log('Created dist folder')
  }

  console.log('Zipping Bundle...')
  execSync(
    `zip dist/${zipFileName}.zip -r . -x ".git/*" ".env" "node_modules/*" "coverage/*" ".github/*" ".fusion/*" ".circleci/*" "data/*" "mocks/*" "dist/*" "src/*.scss" ".stylelintrc.json" "obf-provisioning.js"`,
  )
  console.log(`Zipped bundle can be found at dist/${zipFileName}`)
}

const setServiceValues = (response) => {
  const { data: { lambdas = [] } = {} } = response
  latestServiceVersion =
    lambdas && lambdas.length > 0 ? lambdas[lambdas.length - 1].Version : 0
  console.log('Latest Service Version: ', latestServiceVersion)
}

async function upload(zipFileName, deployUrl, auth) {
  console.log(`Beginning Upload to ${deployUrl}`)
  const form = new FormData()
  form.append('name', zipFileName)
  form.append('bundle', fs.createReadStream(`dist/${zipFileName}.zip`))
  try {
    const response = await axios.get(`${deployUrl}services`, {
      headers: {
        Authorization: `Bearer ${auth}`,
      },
    })
    setServiceValues(response)
    await axios.post(`${deployUrl}bundles`, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${auth}`,
        ...form.getHeaders(),
      },
    })
    console.log(`Upload to ${deployUrl} successful:`)
  } catch (error) {
    console.error('Upload failed:', error)
    throw error
  }
}

async function deploy(zipFileName, deployUrl, auth) {
  console.log(`Deploying ${zipFileName} bundle to ${deployUrl}`)
  try {
    await axios.post(
      `${deployUrl}services?bundle=${zipFileName}&version=latest`,
      null,
      {
        headers: {
          Authorization: `Bearer ${auth}`,
        },
      },
    )
    console.log(`Bundle has been successfully deployed`)
  } catch (e) {
    console.error('Deployment step failed!', e)
    await Promise.reject(e)
  }
}

const getLatestServiceVersion = (response) => {
  const { data: { lambdas = [] } = {} } = response

  const currentVersion = lambdas[lambdas.length - 1].Version
  if (latestServiceVersion < currentVersion) {
    console.log('Bundle successfully deployed.')
    return currentVersion
  }
  return null
}

const checkDeployment = async (deployUrl, auth, limit) => {
  console.log(`Checking if deployment has completed...`)

  for (let i = 0; i < limit; i += 1) {
    await sleep(delay)
    const response = await axios.get(`${deployUrl}services`, {
      headers: {
        Authorization: `Bearer ${auth}`,
      },
    })
    const newValue = getLatestServiceVersion(response)
    if (newValue) return newValue
  }

  throw new Error(
    'Bundle did not deploy within the set time. Further investigation required. One possible solution is to increase the timeout, if the bundle was eventually deployed',
  )
}

async function promote(bundleVersion, deployUrl, auth) {
  console.log('Attempting to promote service version: ', bundleVersion)
  try {
    if (!bundleVersion) {
      throw new Error(
        'The version number argument passed to the promote function is falsy',
      )
    }
    await axios.post(`${deployUrl}services/${bundleVersion}/promote`, null, {
      headers: {
        Authorization: `Bearer ${auth}`,
      },
    })
    console.log(`${bundleVersion} successfully promoted`)
  } catch (e) {
    console.error('Error in Promotion step!', e)
    await Promise.reject(e)
  }
}

async function zipAndUpload() {
  try {
    zipBundle(zipFileName)
    for (const env of envs) {
      const { baseUrl, auth } = fetchEnvironmentVariables(env)
      const deployUrl = `${baseUrl}/deployments/fusion/`
      try {
        await upload(zipFileName, deployUrl, auth)
        await deploy(zipFileName, deployUrl, auth)
        const version = await checkDeployment(deployUrl, auth, timeout)
        await promote(version, deployUrl, auth)
      } catch (error) {
        console.error('Upload failed, deployment skipped for environment:', env)
      }
    }
    console.log('OBF Provisioning Complete')
  } catch (error) {
    console.log('There was an error during deployment:', error)
  }
}

async function configureAndDeploy() {
  try {
    addToGitignore()
    await fetchSiteData()
    await updateEnvironment()
    await zipAndUpload()
  } catch (error) {
    console.log('There wa an error during deployment:', error)
  }
}

const command = process.argv[2]

if (!command) {
  console.error('Usage: node obf-provisioning.js <command> ')
  process.exit(1)
}

switch (command) {
  case 'configure-bundle':
    fetchSiteData()
    updateEnvironment()
    addToGitignore()
    break
  case 'zip':
    zipBundle()
    break
  case 'deploy':
    zipAndUpload()
    break
  case 'configure-and-deploy':
    configureAndDeploy()
    break
  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}
