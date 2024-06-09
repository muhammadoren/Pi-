const express = require('express');
const bodyParser = require('body-parser');
const freeport = require('freeport');
const ProxyChain = require('proxy-chain');
const puppeteer = require('puppeteer-core');
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require('fs');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/pi', async (req, res) => {
  try {
    const query = req.query.pi;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "pi" is required' });
    }

    const result = await pi(query);
    res.json({ result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

async function pi(query) {
  return new Promise((resolve, reject) => {
    freeport(async (err, port) => {
      if (err) {
        reject('Error finding free port:', err);
      }

      const proxyServer = new ProxyChain.Server({ port });

      proxyServer.listen(async () => {
        console.log(`Proxy server listening on port ${port}`);

        const { stdout: chromiumPath } = await promisify(exec)("which chromium");

        const browser = await puppeteer.launch({
          headless: false,
          executablePath: chromiumPath.trim(),
          ignoreHTTPSErrors: true,
          args: [
            '--ignore-certificate-errors',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            `--proxy-server=127.0.0.1:${port}`
          ]
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_5_7;en-us) AppleWebKit/530.17 (KHTML, like Gecko) Version/4.0 Safari/530.17");
        const cookies = JSON.parse(fs.readFileSync('cookies-pi.json', 'utf8'));

        await page.setCookie(...cookies);

        await page.goto('https://pi.ai', { waitUntil: 'networkidle2' });

        try {
          await page.waitForSelector('.t-body-chat', { timeout: 5000 });
          await page.type('.t-body-chat', query);
          await page.waitForSelector('.bg-primary-600', { timeout: 5000 });
          await page.click('.bg-primary-600');
        } catch (error) {
          console.error('Error interacting with the page:', error);
          await browser.close();
          proxyServer.close(() => {});
          reject('Error interacting with the page');
        }

        // Wait for the response
        await page.waitForTimeout(5000);

        const response = await page.evaluate(() => {
          const elements = document.querySelectorAll('.whitespace-pre-wrap');
          let textContent = '';
          elements.forEach(element => {
            textContent += element.textContent.trim() + '\n';
          });

          const match = textContent.match(/(\n.*\n\n)$/);
          const lastText = match ? match[1] : '';

          return lastText.trim();
        });

        await browser.close();
        proxyServer.close(() => {});

        resolve(response);
      });
    });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
