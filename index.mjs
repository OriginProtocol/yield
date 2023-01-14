"use strict";

import * as fs from 'fs';
import cron from 'node-cron';
import fetch from 'node-fetch';
import diff from 'diff-arrays-of-objects';
import nodemailer from 'nodemailer';
import { htmlToText } from 'nodemailer-html-to-text';

const API_URL = 'https://yields.llama.fi/pools';

// set up mail service
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  secure: false,
  auth: {
    user: 'name.cassin76@ethereal.email',
    pass: 'GhBk1aQURBK8mAVgfa',
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

const compare = (pools) => {
  fs.readFile('last.json', (err, data) => {
    if (err) throw err;

    let prevPools = JSON.parse(data);

    prevPools.shift();
    pools.pop()

    const { added, updated, removed } = diff(prevPools, pools, 'pool');
    // console.log('added', added);
    // console.log('updated', updated);
    // console.log('removed', removed);
    sendEmail(added, updated, removed);
  });
};

const sendEmail = (added, updated, removed) => {
  let html = '';

  html += '<h1>Defi Llama activity</h1>';

  function buildTable(pools, label) {
    html += '<table style="margin-bottom: 21px;">';
    html += `<thead><th colspan="2" style="text-align: left;">${pools.length} ${label}</th></thead>`;
    html += '<tbody>';

    pools.forEach(({ pool, project, symbol, tvlUsd, apyBase, apyReward, apy, stablecoin, ilRisk, exposure }) => {
      html += `<tr><td colspan="2"><a href="https://defillama.com/yields/pool/${pool}">${project}: ${symbol}</a></td></tr>`;
      html += `<tr><td>TVL</td><td>$${tvlUsd}</td></tr>`;
      html += `<tr><td>APY</td><td>${apyBase} + ${apyReward} = ${apy}%</td></tr>`;
      html += `<tr><td>Stablecoin</td><td>${stablecoin}</td></tr>`;
      html += `<tr><td>IL risk</td><td>${ilRisk}</td></tr>`;
      html += `<tr><td>Exposure</td><td>${exposure}</td></tr>`;
    });

    html += '</tbody>';
    html += '</table>';
  }

  buildTable(added, 'added');
  buildTable(updated, 'updated');
  buildTable(removed, 'removed');

  transporter.sendMail({
    from: '"Name Cassin" <name.cassin76@ethereal.email>',
    to: '"Gregory Herzog" <gregory38@ethereal.email>',
    subject: "Yield updates",
    html,
  }, (err, info) => {
    console.log("Message sent: %s", info.messageId);

    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  });
};

cron.schedule('* * * * *', async () => {
  console.log('One minute closer to death ☠️');

  const pools = await getPools();
  // To-do: handle non-Ethereum pools
  let filtered = pools.filter(p => p.chain === 'Ethereum');

  console.log(`${filtered.length} Ethereum pools found`);
   
  const data = JSON.stringify(filtered);

  save(data);

  compare(filtered);
});
