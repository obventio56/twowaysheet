"use strict";

const { v4: uuidv4 } = require("uuid");
const { google } = require("googleapis");
const { GoogleAuth } = require("google-auth-library");
const functions = require("@google-cloud/functions-framework");
const { Datastore } = require("@google-cloud/datastore");
const Airtable = require("airtable");
const axios = require("axios");
var _ = require("lodash");

const AIRTABLE_ENDPOINT = "https://api.airtable.com";
const UPDATE_SHEET_URL = "https://update-sheet-gz74lveyrq-uc.a.run.app";
const RECEIVE_NOTIFICATION_URL =
  "https://receive-notification-gz74lveyrq-uc.a.run.app";

/**
 * Helper to get sheetId from uri,
 * which is sometimes all we have
 */
function sheetIdFromUri(URI) {
  // ex. https://www.googleapis.com/drive/v3/files/1ghUWZXWVS8Fbga-5wNut2JblcANfghhfIxHOeppab0A?acknowledgeAbuse=false&supportsAllDrives=false&supportsTeamDrives=false&alt=json
  return URI.split("files/")[1].split("?")[0];
}

/**
 * NoSQl records look roughly like follows:
 *
 * {
 *    sheetId: "string",
 *    airtableAPIKey: "string",
 *    airtableBaseId: "string",
 *    airtableTableId: "string"
 * }
 */

/**
 * Gets contents of Airtable base with given ids
 * as row-major 2D array
 */
async function getAirtableContents(apiKey, baseId, tableId) {
  Airtable.configure({
    endpointUrl: AIRTABLE_ENDPOINT,
    apiKey: apiKey,
  });

  // Fetch all records from airtable base/table
  const base = Airtable.base(baseId);
  const airtableRecords = await new Promise((resolve, reject) => {
    var records = [];
    base(tableId)
      .select({
        maxRecords: 1000,
        view: "Grid view",
      })
      .eachPage(
        function page(pageRecords, fetchNextPage) {
          records = [...records, ...pageRecords];
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
  const keys = Object.keys(cleanRecords[0]);
  // Return as row-major 2D array
  return [keys, ...cleanRecords.map((r) => keys.map((k) => r[k]))];
}

/**
 * Overwrites Airtable base with given id
 * to values in content (row-major 2D array)
 */
async function setAirtableContents(apiKey, baseId, tableId, content) {
  Airtable.configure({
    endpointUrl: AIRTABLE_ENDPOINT,
    apiKey: apiKey,
  });
  const base = Airtable.base(baseId);

  // Rearrange from 2d array to json collection
  const [keys, ...values] = content;

  const collection = values.map((v) => {
    return v.reduce((cul, p, index) => {
      return { ...cul, [keys[index]]: p };
    }, {});
  });

  await Promise.all([
    // Update existing records
    ..._.chunk(
      collection
        .filter((c) => c.id)
        .map((c) => ({ id: c.id, fields: { ...c, id: undefined } })),
      10
    ).map((ch) => base(tableId).update(ch)),
    // Create new records
    ..._.chunk(
      collection
        .filter((c) => !c.id)
        .map((c) => ({ fields: { ...c, id: undefined } })),
      10
    ).map((ch) => base(tableId).create(ch)),
  ]);
}

/**
 * Gets contents of google sheet with given id
 */
async function getSheetContents(sheetId) {
  // Auth sheets API
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // query sheet
  const response = await sheets.spreadsheets.values.get({
    range: "Sheet1",
    spreadsheetId: sheetId,
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return response.data.values;
}

/**
 * Overwrites google sheet with given id
 * to values in content (row-major 2D array)
 */
async function setSheetContents(sheetId, content) {
  // Auth sheets API
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // Clear sheet
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: "Sheet1",
  });

  // Update sheet
  await sheets.spreadsheets.values.update({
    range: "Sheet1",
    spreadsheetId: sheetId,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      majorDimension: "ROWS",
      range: "Sheet1",
      values: content,
    },
  });
}

/**
 * Connects a google sheet to Airtable base.
 * Initiates change watching on sheet for updates
 * and registers sheet to receive updates from other
 * sheets.
 */
functions.http("connectSheet", async (req, res) => {
  const { airtableAPIKey, airtableTableId, airtableBaseId, sheetId } = req.body;

  // Create connection record
  const datastore = new Datastore({ namespace: "main" });
  await datastore.save({
    key: datastore.key(["connectedSheets"]),
    data: {
      airtableAPIKey,
      airtableTableId,
      airtableBaseId,
      sheetId,
    },
  });

  // Set contents in sheet
  const airtableContents = await getAirtableContents(
    airtableAPIKey,
    airtableBaseId,
    airtableTableId
  );
  await setSheetContents(sheetId, airtableContents);

  // Start watching sheet for changes
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });
  await drive.files.watch({
    fileId: sheetId,
    requestBody: {
      kind: "api#channel",
      id: uuidv4(),
      expiration: Date.now() + 86000000, // Keep open for ~1 day
      type: "webhook",
      address: RECEIVE_NOTIFICATION_URL,
    },
  });

  res.type("text/plain");
  res.send("success");
});

/**
 * Endpoint to receive update notifications from Google.
 * If there is a valid update, updates connected Airtable
 * and triggers update for all connected sheets
 */
functions.http("receiveNotification", async (req, res) => {
  const sheetId = sheetIdFromUri(req.headers["x-goog-resource-uri"]);
  console.log(sheetId);

  // Check who made most recent edit
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });
  const revisions = await drive.revisions.list({
    fileId: sheetId,
    fields: "*",
    pageSize: 1000,
  });

  // Do nothing if this is our bot editing to avoid feedback loop
  if (
    revisions.data.revisions[revisions.data.revisions.length - 1]
      .lastModifyingUser.me
  ) {
    console.log("Received bot updated");
    res.send("success");
    return;
  }

  // Get sheet record from datastore
  const datastore = new Datastore({ namespace: "main" });
  const sheetRecordQuery = datastore
    .createQuery("connectedSheets")
    .filter("sheetId", "=", sheetId);
  const [[sheetRecord]] = await datastore.runQuery(sheetRecordQuery);

  // Update airtable from Google sheet
  const sheetContent = await getSheetContents(sheetId);

  await setAirtableContents(
    sheetRecord.airtableAPIKey,
    sheetRecord.airtableBaseId,
    sheetRecord.airtableTableId,
    sheetContent
  );

  // Get all sheets connected to same query
  const allConnectedSheetsQuery = datastore
    .createQuery("connectedSheets")
    .filter("airtableTableId", "=", sheetRecord.airtableTableId);
  const [allConnectedSheets] = await datastore.runQuery(
    allConnectedSheetsQuery
  );

  // Trigger update requests to all sheets
  await Promise.all(
    allConnectedSheets.map((cs) =>
      axios.post(UPDATE_SHEET_URL, { ...cs, key: undefined })
    )
  );

  res.type("text/plain");
  res.send("success");
});

/**
 * Updates all connected sheets with current results in
 * Airtable.
 */
functions.http("updateSheet", async (req, res) => {
  const { airtableBaseId, airtableAPIKey, sheetId, airtableTableId } = req.body;

  const airtableContents = await getAirtableContents(
    airtableAPIKey,
    airtableBaseId,
    airtableTableId
  );
  await setSheetContents(sheetId, airtableContents);

  res.send("success");
});
