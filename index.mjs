"use strict";

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import cron from 'node-cron';
import fetch from 'node-fetch';
import diff from 'diff-arrays-of-objects';
import nodemailer from 'nodemailer';
import { htmlToText } from 'nodemailer-html-to-text';

dotenv.config();

const API_URL = 'https://yields.llama.fi/pools';

const interestingFields = ['tvlUsd', 'apy', 'stablecoin', 'ilRisk', 'exposure'];
const keysLength = interestingFields.length;

const ONE_MILLION = 1000000;
const ONE_PERCENT = 0.01;
const ONE_PERCENTAGE_POINT = 1.0;

// The TVL above which pools become interesting
const TVL_AMOUNT_THRESHOLD = ONE_MILLION * 10;
// The percentage TVL change that is noteworthy
const TVL_CHANGE_THRESHOLD = ONE_PERCENT * 10;
// The APY above which pools become interesting
const APY_AMOUNT_THRESHOLD = ONE_PERCENTAGE_POINT * 3;
// The percentage point change that is noteworthy
const APY_CHANGE_THRESHOLD = ONE_PERCENTAGE_POINT;

// set up mail service
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
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
  // To-do: use a database
  fs.writeFile('last.json', data, (err) => {
    if (err) throw err;

    console.log(`Pools data saved`);
  });
};

const simulateChanges = (prevPools, pools) => {
  prevPools.shift();
  prevPools.shift();

  let prevPool;

  prevPool = prevPools.find(p => p.tvlUsd < TVL_AMOUNT_THRESHOLD);

  pools.find(p => p.pool === prevPool.pool).tvlUsd += TVL_AMOUNT_THRESHOLD;

  pools[111].tvlUsd += prevPools[111].tvlUsd * TVL_CHANGE_THRESHOLD;
  pools[222].tvlUsd -= prevPools[222].tvlUsd * TVL_CHANGE_THRESHOLD;

  prevPool = prevPools.find(p => p.apy < APY_AMOUNT_THRESHOLD);

  pools.find(p => p.pool === prevPool.pool).apy = APY_AMOUNT_THRESHOLD;

  pools[333].apy += APY_CHANGE_THRESHOLD;
  pools[444].apy -= APY_CHANGE_THRESHOLD;

  pools[555].stablecoin = !pools[555].stablecoin;
  pools[777].ilRisk = pools[777].ilRisk === 'no' ? 'yes' : 'no';
  pools[888].exposure = pools[888].exposure === 'single' ? 'multi' : 'single';

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
        const tvlChange = Math.round((tvlDiff / prev.tvlUsd) * 100) / 100;
        const apyDiff = Math.round((curr.apy - prev.apy) * 100) / 100;
        const attrDiff = curr.stablecoin !== prev.stablecoin || curr.ilRisk !== prev.ilRisk || curr.exposure !== prev.exposure;
        const tvlCrossedThreshold = curr.tvlUsd >= TVL_AMOUNT_THRESHOLD && prev.tvlUsd < TVL_AMOUNT_THRESHOLD;
        const tvlChangedConsiderably = Math.abs(tvlChange) >= TVL_CHANGE_THRESHOLD;
        const tvlIsInteresting = tvlCrossedThreshold || tvlChangedConsiderably;
        const apyCrossedThreshold = curr.apy >= APY_AMOUNT_THRESHOLD && prev.apy < APY_AMOUNT_THRESHOLD;
        const apyChangedConsiderably = Math.abs(apyDiff) >= APY_CHANGE_THRESHOLD;
        const apyIsInteresting = apyCrossedThreshold || apyChangedConsiderably;

        if (!tvlIsInteresting && !apyIsInteresting && !attrDiff) {
          return;
        }

        html += `<tr><td colspan="2"><a href="https://defillama.com/yields/pool/${curr.pool}">${curr.project}: ${curr.symbol}</a></td></tr>`;

        if (tvlIsInteresting) {
          color = tvlDiff > 0 ? 'green' : 'red';
          html += `<tr><td>TVL</td><td>$${curr.tvlUsd.toLocaleString('en-US')} <span style="color: ${color};">(${tvlDiff > 0 ? '+' : ''}${tvlChange * 100}%)</span></td></tr>`;
        }

        if (apyIsInteresting) {
          color = apyDiff > 0 ? 'green' : 'red';
          html += `<tr><td>APY</td><td>${Math.round(curr.apy * 100) / 100}% <span style="color: ${color};">(${apyDiff > 0 ? '+' : ''}${apyDiff * 100} bp)</span></td></tr>`;
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
      pools.forEach(({ pool, project, symbol, tvlUsd, apyBase, apyReward, apy, stablecoin, ilRisk, exposure }) => {
        html += `<tr><td colspan="2"><a href="https://defillama.com/yields/pool/${pool}">${project}: ${symbol}</a></td></tr>`;
        html += `<tr><td>TVL</td><td>$${(tvlUsd || 0).toLocaleString('en-US')}</td></tr>`;
        html += `<tr><td>APY</td><td>${apyBase || 0} + ${apyReward || 0} = ${apy || 0}%</td></tr>`;
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
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO,
    subject: "Yield landscape updates",
    html,
  }, (err, info) => {
    if (err) {
      throw err;
    }

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
const frequency = '0 6 * * *';

// every minute (for testing)
// const frequency = '* * * * *';

cron.schedule(frequency, () => {
  console.log('One day closer to death ☠️');

  checkForUpdates();
}, {
  timezone: "America/Los_Angeles",
});

// generate the initial data set if it doesn't exist
checkForUpdates();
