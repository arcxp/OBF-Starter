/* eslint-disable no-fallthrough */
/* eslint-disable no-undef */
/* eslint-disable no-case-declarations */
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
function fetchOrgID() {
  if (!contentBase) {
    console.log('No CONTENT_BASE found in .env')
  } else {
    return contentBase.split('.')[contentBase.split('.').length - 3]
  }
}
const orgID = fetchOrgID()

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
const envs = fetchEnvs()
const delay = process.env.POLLING_DELAY || 10000
const timeout = process.env.TIMEOUT || 30

// PREPARE THE BUNDLE

function deleteFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Error deleting file ${filePath}: ${err}`)
    } else {
      console.log(`File ${filePath} has been deleted.`)
    }
  })
}

function updateEnvironment() {
  const envsToCheck = ['outboundfeeds', 'outboundfeeds-sandbox']

  envsToCheck.forEach((env) => {
    const environmentPath = `environment/themesinternal-${env}.js`
    if (envs.includes(env)) {
      const writePath = `environment/${orgID}-${env}.js`
      console.log(`Updating ${writePath}`)

      let resizerEncrypted
      if (env === 'outboundfeeds') {
        resizerEncrypted = process.env.PROD_RESIZER_ENCRYPTED
      } else if (env === 'outboundfeeds-sandbox') {
        resizerEncrypted = process.env.SANDBOX_RESIZER_ENCRYPTED
      } else {
        console.log('No resizer values found')
        return
      }

      const environmentFile = fs.readFileSync(environmentPath, 'utf-8')

      const updatedEnvironmentFile = environmentFile.replace(
        '%{ ENCRYPTED RESIZER KEY GOES HERE }',
        `%{${resizerEncrypted}}`,
      )
      fs.writeFileSync(writePath, updatedEnvironmentFile, 'utf-8')
    }
    deleteFile(environmentPath)
  })
}

function updateBlocksJSON(data) {
  const sitesObject = {}

  data.forEach((site) => {
    sitesObject[site._id] = {
      siteProperties: {
        feedDomainURL: `https://www.${site._id}.com`,
        resizerURL: `https://${orgID}-${site._id}-prod.web.arc-cdn.net/resizer`,
        feedTitle: site.display_name || site._id,
      },
    }
  })

  const blocksPath = 'blocks.json'
  const blocksJSON = JSON.parse(fs.readFileSync(blocksPath, 'utf-8'))

  updatedContent = blocksJSON
  updatedContent.values.sites = sitesObject
  fs.writeFileSync(blocksPath, JSON.stringify(updatedContent, null, 2), 'utf-8')
}

function fetchSiteData() {
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

    axios
      .get(apiUrl, options)
      .then((res) => {
        fs.writeFileSync(
          'mocks/siteservice/api/v3/website',
          JSON.stringify(res.data, null, 2),
          'utf-8',
        )
        updateBlocksJSON(res.data)
      })
      .catch((error) => {
        console.error('Error fetching data:', error.message)
      })
  } catch (error) {
    console.error('Error:', error.message)
  }
}

function addToGitignore() {
  const gitignorePath = '.gitignore'

  // Read the current content of .gitignore
  fs.readFile(gitignorePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading ${gitignorePath}: ${err.message}`)
      return
    }

    // Check if the file is already in .gitignore
    if (data.includes('obf-provisioning.js')) {
      console.log(`File 'obf-provisioning.js' is already in ${gitignorePath}.`)
    } else {
      // Append the file to .gitignore
      const updatedContent = data + `\nobf-provisioning.js\n`

      // Write the updated content back to .gitignore
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
  // execSync('zip bundle.zip -r . -x .git/\* node_modules/\* coverage/\* .github/\* .fusion/\* mocks/\* __mocks__/\* data/\* README.md documentation/\* \*.test.jsx .env .npmrc')
  console.log(`Zipped bundle can be found at dist/${zipFileName}`)
  // return zipFileName
}

let latestServiceVersion = null
// let services = null

const setServiceValues = (response) => {
  const { data: { lambdas = [] } = {} } = response
  latestServiceVersion =
    lambdas && lambdas.length > 0 ? lambdas[lambdas.length - 1].Version : 0
  console.log('Latest Service Version: ', latestServiceVersion)
}

async function upload(zipFileName, deployUrl, auth) {
  console.log(`Beginning Upload to ${deployUrl}`)
  const form = new FormData()
  // form.append('name', zipFileName);
  form.append('name', zipFileName)
  form.append('bundle', fs.createReadStream(`dist/${zipFileName}.zip`))
  try {
    const response = await axios.get(`${deployUrl}services`, {
      headers: {
        Authorization: `Bearer ${auth}`,
      },
    })
    // console.log('Current services..', response.data)
    setServiceValues(response)
    // const response = await axios.post(`${deployUrl}bundles`, form, {
    await axios.post(`${deployUrl}bundles`, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${auth}`,
        ...form.getHeaders(),
      },
    })
    // console.log(`Upload to ${deployUrl} successful:`, response)
    console.log(`Upload to ${deployUrl} successful:`)
  } catch (error) {
    console.error('Upload failed:', error)
    // console.error('Upload failed')
    throw error
  }
}

async function deploy(zipFileName, deployUrl, auth) {
  console.log(`Deploying ${zipFileName} bundle to ${deployUrl}`)
  try {
    await axios.post(
      `${deployUrl}services?bundle=${zipFileName}&version=latest`,
      // `${contentBase}/deployments/fusion/services?bundle=BLAKE_DEPLOY_TEST_2&version=latest`,
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

  /* eslint-disable no-await-in-loop */
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
  /* eslint-enable no-await-in-loop */

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
  // const date = new Date().toISOString()
  // const dateStr = date.replaceAll(/[^a-zA-Z0-9-]/gi, '-')
  // const zipFileName = `${orgID}-${dateStr}.zip`;
  const zipFileName = `${orgID}-obf-bundle`
  // const zipFileName = 'OBF-Starter-Bundle'

  try {
    zipBundle(zipFileName)
    for (const env of envs) {
      let baseUrl = ''
      let auth = ''

      if (env === 'outboundfeeds') {
        baseUrl = process.env.OBF_DEPLOYER_ENDPOINT
        auth = process.env.OBF_DEPLOYER_ACCESS_TOKEN
      }
      if (env === 'outboundfeeds-sandbox') {
        baseUrl = process.env.OBF_SANDBOX_DEPLOYER_ENDPOINT
        auth = process.env.OBF_SANDBOX_DEPLOYER_ACCESS_TOKEN
      }
      const deployUrl = `${baseUrl}/deployments/fusion/`
      try {
        await upload(zipFileName, deployUrl, auth)
        await deploy(zipFileName, deployUrl, auth)
        const version = await checkDeployment(deployUrl, auth, timeout)
        await promote(version, deployUrl, auth)
        console.log('OBF Provisioning Complete')
      } catch (error) {
        console.error('Upload failed, deployment skipped for environment:', env)
      }
    }
  } catch (error) {
    console.log('There was an error during deployment:', error)
  }
}

function testFunction() {
  // const testDate = new Date().toISOString()
  // console.log(testDate.replaceAll(/[^a-zA-Z0-9-]/ig, '-'))
  console.log('Test Function')
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
    zipBundle('test-zip')
    break
  case 'deploy':
    zipAndUpload()
    break
  case 'configure-and-deploy':
    fetchSiteData()
    updateEnvironment()
    addToGitignore()
    zipAndUpload()
    break
  case 'test':
    console.log(envs)
    testFunction()
    break
  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}
