// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

/* eslint-disable no-unused-vars */

// This should be in a store somewhere, obviously
const AIRTABLE_APIKEY = "keyTXBEYCNMOdQDOX";
const AIRTABLE_ENDPOINT = "https://api.airtable.com";
const AIRTABLE_BASE = "appaF7YfbaCllQaiZ";
const AIRTABLE_TABLE = "tblnrdt60eb9wGdXB";

// [START functions_helloworld_http]
// [START functions_helloworld_get]
const { google } = require("googleapis");
const { GoogleAuth } = require("google-auth-library");

const functions = require("@google-cloud/functions-framework");
// [END functions_helloworld_get]
const escapeHtml = require("escape-html");
// [END functions_helloworld_http]
const Airtable = require("airtable");
Airtable.configure({
  endpointUrl: AIRTABLE_ENDPOINT,
  apiKey: AIRTABLE_APIKEY,
});

const { Parser } = require("json2csv");

// [START functions_helloworld_get]

// Register an HTTP function with the Functions Framework that will be executed
// when you make an HTTP request to the deployed function's endpoint.
functions.http("helloGET", (req, res) => {
  res.send("Hello World!");
});
// [END functions_helloworld_get]

// Fetch data from Airtable API and format as csv in string
async function fetchAirTableBase() {
  // Fetch all records from airtable base/table
  const base = Airtable.base(AIRTABLE_BASE);
  const airtableRecords = await new Promise((resolve, reject) => {
    var records = [];
    base(AIRTABLE_TABLE)
      .select({
        // Selecting the first 3 records in Grid view:
        maxRecords: 1000,
        view: "Grid view",
      })
      .eachPage(
        function page(pageRecords, fetchNextPage) {
          // This function (`page`) will get called for each page of records.

          records = [...records, ...pageRecords];

          // To fetch the next page of records, call `fetchNextPage`.
          // If there are more records, `page` will get called again.
          // If there are no more records, `done` will get called.
          fetchNextPage();
        },
        function done(err) {
          if (err) {
            reject(err);
          }
          resolve(records);
        }
      );
  });

  // Remove extra Airtable metadata
  const cleanRecords = airtableRecords.map((r) => ({ id: r.id, ...r.fields }));

  // Convert to CSV and return
  const parser = new Parser();
  return parser.parse(cleanRecords);
}

// Return data from Airtable as stream
functions.http("getCSV", async (req, res) => {
  res.type("text/plain");
  res.send(await fetchAirTableBase());
});

// Update airtable from sheet
functions.http("updateAirtable", async (req, res) => {
  const auth = new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });
  const sheets = google.sheets({ version: "v4", auth });
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId: "1ghUWZXWVS8Fbga-5wNut2JblcANfghhfIxHOeppab0A",
    range: "Sheet1",
  });

  res.type("text/plain");
  res.send(data);
});

/**
 * gcloud functions deploy set-airtable \
--gen2 \
--runtime=nodejs16 \
--region=us-central1 \
--source=. \
--entry-point=updateAirtable \
--trigger-http \
--allow-unauthenticated
--service-account twowaysheet-363518@appspot.gserviceaccount.com
 */

// [START functions_helloworld_http]

/**
 * Responds to an HTTP request using data from the request body parsed according
 * to the "content-type" header.
 *
 * @param {Object} req Cloud Function request context.
 * @param {Object} res Cloud Function response context.
 */
functions.http("helloHttp", (req, res) => {
  res.send(`Hello ${escapeHtml(req.query.name || req.body.name || "World")}!`);
});
// [END functions_helloworld_http]

// [START functions_helloworld_pubsub]
/**
 * Background Cloud Function to be triggered by Pub/Sub.
 * This function is exported by index.js, and executed when
 * the trigger topic receives a message.
 *
 * @param {object} message The Pub/Sub message.
 * @param {object} context The event metadata.
 */
exports.helloPubSub = (message, context) => {
  const name = message.data
    ? Buffer.from(message.data, "base64").toString()
    : "World";

  console.log(`Hello, ${name}!`);
};
// [END functions_helloworld_pubsub]

// [START functions_helloworld_storage]
/**
 * Generic background Cloud Function to be triggered by Cloud Storage.
 * This sample works for all Cloud Storage CRUD operations.
 *
 * @param {object} file The Cloud Storage file metadata.
 * @param {object} context The event metadata.
 */
exports.helloGCS = (file, context) => {
  console.log(`  Event: ${context.eventId}`);
  console.log(`  Event Type: ${context.eventType}`);
  console.log(`  Bucket: ${file.bucket}`);
  console.log(`  File: ${file.name}`);
  console.log(`  Metageneration: ${file.metageneration}`);
  console.log(`  Created: ${file.timeCreated}`);
  console.log(`  Updated: ${file.updated}`);
};
// [END functions_helloworld_storage]

/**
 * Background Cloud Function that throws an error.
 *
 * @param {object} event The Cloud Functions event.
 * @param {object} context The event metadata.
 * @param {function} callback The callback function.
 */

exports.helloError = (event, context, callback) => {
  // [START functions_helloworld_error]
  // These WILL be reported to Error Reporting
  throw new Error("I failed you"); // Will cause a cold start if not caught

  // [END functions_helloworld_error]
};

/**
 * Background Cloud Function that throws a value.
 *
 * @param {object} event The Cloud Functions event.
 * @param {object} context The event metadata.
 * @param {function} callback The callback function.
 */
exports.helloError2 = (event, context, callback) => {
  // [START functions_helloworld_error]
  // These WILL be reported to Error Reporting
  console.error(new Error("I failed you")); // Logging an Error object
  console.error("I failed you"); // Logging something other than an Error object
  throw 1; // Throwing something other than an Error object
  // [END functions_helloworld_error]
};

/**
 * Background Cloud Function that returns an error.
 *
 * @param {object} event The Cloud Functions event.
 * @param {object} context The event metadata.
 * @param {function} callback The callback function.
 */
exports.helloError3 = (event, context, callback) => {
  // This will NOT be reported to Error Reporting
  // [START functions_helloworld_error]
  callback("I failed you");
  // [END functions_helloworld_error]
};

// HTTP Cloud Function that returns an error.
functions.http("helloError4", (req, res) => {
  // This will NOT be reported to Error Reporting
  // [START functions_helloworld_error]
  res.status(500).send("I failed you");
  // [END functions_helloworld_error]
});
