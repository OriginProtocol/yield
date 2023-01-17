"use strict";

import * as fs from 'fs';
import cron from 'node-cron';
import fetch from 'node-fetch';
import diff from 'diff-arrays-of-objects';
import nodemailer from 'nodemailer';
import { htmlToText } from 'nodemailer-html-to-text';

const API_URL = 'https://yields.llama.fi/pools';

const interestingFields = ['tvlUsd', 'apy', 'stablecoin', 'ilRisk', 'exposure'];
const keysLength = interestingFields.length;

// To-do: measure rate of change or velocity instead of simple numbers
const TVL_CHANGE_THRESHOLD = 1000000;
const APY_CHANGE_THRESHOLD = 0.5;

// set up mail service
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  secure: false,
  auth: {
    user: 'gladyce.herzog@ethereal.email',
    pass: 'MHgmmG8VpnukGKcZKX',
  },
});

transporter.use('compile', htmlToText());

const getPools = async () => {
  const response = await fetch(API_URL);
  const content = await response.json();

  if (content.status !== 'success') {
    // To-do: handle failure
  }

  return content.data;
};

const save = (data) => {
  fs.writeFile('last.json', data, (err) => {
    if (err) throw err;

    console.log(`Pools data saved`);
  });
};

const simulateChanges = (prevPools, pools) => {
  prevPools.shift();
  prevPools.shift();
  pools[111].tvlUsd += 12345;
  pools[222].tvlUsd -= 12345678;
  pools[333].apy += 0.12;
  pools[444].apy -= 1.23;
  pools[555].stablecoin = !pools[555].stablecoin;
  pools[666].stablecoin = !pools[666].stablecoin;
  pools[777].ilRisk = 'no';
  pools[888].ilRisk = 'yes';
  pools[999].exposure = 'single';
  pools[1010].exposure = 'multi';
  pools.pop();
  pools.pop();
}

const compare = (pools) => {
  fs.readFile('last.json', (err, data) => {
    if (err) throw err;

    let prevPools = JSON.parse(data);

    // for testing purposes
    simulateChanges(prevPools, pools);

    // To-do: probably abandon diff library because APYs change on every pool constantly
    let { added, updated, removed } = diff(prevPools, pools, 'pool', { updatedValues: diff.updatedValues.both });

    // filter out the diffs we don't care about
    updated = updated.filter(([ prev, curr ]) => {
      let include = false;

      // exclude changes that don't involve interesting fields
      for (let i = 0; i < keysLength; i++) {
        const k = interestingFields[i];

        if (prev[k] !== curr[k]) {
          include = true;

          break;
        }
      }

      return include;
    });

    sendEmail(added, updated, removed);
  });
};

const sendEmail = (added, updated, removed) => {
  let html = '';

  html += '<h1>DeFiLlama activity</h1>';

  function addRows(pools, label) {
    // "updated" containts arrays
    if (label === 'updated') {
      pools.forEach(([ prev, curr ]) => {
        let color;
        const tvlDiff = curr.tvlUsd - prev.tvlUsd;
        const apyDiff = Math.round((curr.apy - prev.apy) * 100) / 100;
        const attrDiff = curr.stablecoin !== prev.stablecoin || curr.ilRisk !== prev.ilRisk || curr.exposure !== prev.exposure;
        const tvlIsInteresting = Math.abs(tvlDiff) > TVL_CHANGE_THRESHOLD;
        const apyIsInteresting = Math.abs(apyDiff) > APY_CHANGE_THRESHOLD

        if (!tvlIsInteresting && !apyIsInteresting && !attrDiff) {
          return;
        }

        html += `<tr><td colspan="2"><a href="https://defillama.com/yields/pool/${curr.pool}">${curr.project}: ${curr.symbol}</a></td></tr>`;

        if (tvlIsInteresting) {
          color = tvlDiff > 0 ? 'green' : 'red';
          html += `<tr><td>TVL</td><td style="color: ${color};">${tvlDiff > 0 ? '+' : ''}$${tvlDiff.toLocaleString('en-US')}</td></tr>`;
        }

        if (apyIsInteresting) {
          color = apyDiff > 0 ? 'green' : 'red';
          html += `<tr><td>APY</td><td style="color: ${color};">${apyDiff > 0 ? '+' : ''}${apyDiff} bp</td></tr>`;
        }

        if (curr.stablecoin !== prev.stablecoin) {
          color = curr.stablecoin ? 'green' : 'red';
          html += `<tr><td>Stablecoin</td><td style="color: ${color};">${curr.stablecoin}</td></tr>`;
        }

        if (curr.ilRisk !== prev.ilRisk) {
          color = curr.ilRisk === 'no' ? 'green' : 'red';
          html += `<tr><td>IL risk</td><td style="color: ${color};">${curr.ilRisk}</td></tr>`;
        }        

        if (curr.exposure !== prev.exposure) {
          color = curr.exposure === 'single' ? 'green' : 'red';
          html += `<tr><td>Exposure</td><td style="color: ${color};">${curr.exposure}</td></tr>`;
        }
      });
    // "added" and "removed" contain objects
    } else {
      pools.forEach(({ pool, project, symbol, tvlUsd = 0, apyBase = 0, apyReward = 0, apy = 0, stablecoin, ilRisk, exposure }) => {
        html += `<tr><td colspan="2"><a href="https://defillama.com/yields/pool/${pool}">${project}: ${symbol}</a></td></tr>`;
        html += `<tr><td>TVL</td><td>$${tvlUsd.toLocaleString('en-US')}</td></tr>`;
        html += `<tr><td>APY</td><td>${apyBase} + ${apyReward} = ${apy}%</td></tr>`;
        html += `<tr><td>Stablecoin</td><td>${stablecoin}</td></tr>`;
        html += `<tr><td>IL risk</td><td>${ilRisk}</td></tr>`;
        html += `<tr><td>Exposure</td><td>${exposure}</td></tr>`;
      });
    }
  }

  function buildTable(pools, label) {
    html += '<table style="margin-bottom: 21px;">';
    html += `<thead><th colspan="2" style="text-align: left;">${pools.length} ${label}</th></thead>`;
    html += '<tbody>';

    addRows(pools, label);

    html += '</tbody>';
    html += '</table>';
  }

  buildTable(added, 'added');
  buildTable(updated, 'updated');
  buildTable(removed, 'removed');

  transporter.sendMail({
    from: '"Gladyce Herzog" <gladyce.herzog@ethereal.email>',
    to: '"Gregory Herzog" <gregory38@ethereal.email>',
    subject: "Yield landscape updates",
    html,
  }, (err, info) => {
    console.log("Message sent: %s", info.messageId);

    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  });
};

const checkForUpdates = async () => {
  const pools = await getPools();
  // To-do: handle non-Ethereum pools
  let filtered = pools.filter(p => p.chain === 'Ethereum');

  console.log(`${filtered.length} Ethereum pools found`);
   
  const data = JSON.stringify(filtered);

  save(data);

  compare(filtered);
};

// 6:00 AM Pacific every day
// const frequency = '0 6 * * *';

// every minute (for testing)
const frequency = '* * * * *';

cron.schedule(frequency, () => {
  console.log('One week closer to death ☠️');

  checkForUpdates();
}, {
  timezone: "America/Los_Angeles",
});

checkForUpdates();
