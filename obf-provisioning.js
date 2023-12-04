/* eslint-disable no-undef */
/* eslint-disable no-case-declarations */
const fs = require('fs')
const https = require('https')
require('dotenv').config()

function fetchOrgID() {
  const contentBase = process.env.CONTENT_BASE
  if (!contentBase) {
    console.log('No CONTENT_BASE found in .env')
  } else {
    return contentBase.split('.')[contentBase.split('.').length - 3]
  }
}

function updateEnvironment() {
  const sandboxEnvironmentPath =
    'environment/themesinternal-outboundfeeds-sandbox.js'
  const sandboxEnvironmentFile = fs.readFileSync(
    sandboxEnvironmentPath,
    'utf-8',
  )

  const prodEnvironmentPath = 'environment/themesinternal-outboundfeeds.js'
  const prodEnvironmentFile = fs.readFileSync(prodEnvironmentPath, 'utf-8')

  const orgID = fetchOrgID()

  const sandboxWritePath = `environment/${orgID}-outboundfeeds-sandbox.js`
  const prodWritePath = `environment/${orgID}-outboundfeeds.js`

  fs.writeFileSync(sandboxWritePath, sandboxEnvironmentFile, 'utf-8')
  fs.writeFileSync(prodWritePath, prodEnvironmentFile, 'utf-8')
  fs.unlink(sandboxEnvironmentPath, (err) => {
    if (err) {
      console.error(`Error deleting file ${sandboxEnvironmentPath}: ${err}`)
    } else {
      console.log(`File ${sandboxEnvironmentPath} has been deleted.`)
    }
  })
  fs.unlink(prodEnvironmentPath, (err) => {
    if (err) {
      console.error(`Error deleting file ${prodEnvironmentPath}: ${err}`)
    } else {
      console.log(`File ${prodEnvironmentPath} has been deleted.`)
    }
  })
}

function updateBlocksJSON(data) {
  const sitesObject = {}
  const orgID = fetchOrgID()

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
  fs.writeFileSync(blocksPath, JSON.stringify(updatedContent), 'utf-8')
}

function fetchSiteData() {
  try {
    const contentBase = process.env.CONTENT_BASE
    const accessToken = process.env.ARC_ACCESS_TOKEN

    if (!contentBase || !accessToken) {
      throw new Error(
        'CONTENT_BASE or ARC_ACCESS_TOKEN is not defined in environment variables.',
      )
    }

    const apiUrl = `${contentBase}/site/v3/website/`

    const options = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }

    const req = https.request(apiUrl, options, (res) => {
      let data = ''

      // A chunk of data has been received.
      res.on('data', (chunk) => {
        data += chunk
      })

      // The whole response has been received.
      res.on('end', () => {
        fs.writeFileSync('mocks/siteservice/api/v3/website', data, 'utf-8')
        updateBlocksJSON(JSON.parse(data))
      })
    })

    // Handle errors during the request
    req.on('error', (error) => {
      console.error('Error fetching data:', error.message)
    })

    // End the request
    req.end()
  } catch (error) {
    console.error('Error:', error.message)
  }
}

function addToGitignore() {
  const gitignorePath = '.gitignore';

  // Read the current content of .gitignore
  fs.readFile(gitignorePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading ${gitignorePath}: ${err.message}`);
      return;
    }

    // Check if the file is already in .gitignore
    if (data.includes('obf-provisioning.js')) {
      console.log(`File 'obf-provisioning.js' is already in ${gitignorePath}.`);
    } else {
      // Append the file to .gitignore
      const updatedContent = data + `\nobf-provisioning.js\n`;

      // Write the updated content back to .gitignore
      fs.writeFile(gitignorePath, updatedContent, 'utf8', (writeErr) => {
        if (writeErr) {
          console.error(`Error writing to ${gitignorePath}: ${writeErr.message}`);
        } else {
          console.log(`Added 'obf-provisioning.js' to ${gitignorePath}.`);
        }
      });
    }
  });
}

const command = process.argv[2]

if (!command) {
  console.error('Usage: node obf-provisioning.js <command> ')
  process.exit(1)
}

switch (command) {
  case 'configure-bundle':
    fetchOrgID()
    fetchSiteData()
    updateEnvironment()
    addToGitignore()
    break
  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}
