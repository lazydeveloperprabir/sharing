export default {
  // Keep this true until the console output has been verified on one candidate.
  dryRun: true,
  // How many matching reviewer rows to process. Use null to process every match.
  maxCandidates: 1,
  // Wait this many milliseconds for you to finish SSO/login. Use 0 to wait until login completes.
  loginTimeoutMs: 0,
  chrome: {
    cdpUrl: 'http://127.0.0.1:9222',
    // If Chrome is already open without debugging, restart it once (your tabs are restored) so a tab can be added.
    restartIfNeeded: true
  },

  darwinbox: {
    candidateListUrl: 'https://treebo.darwinbox.in/ms/onboarding/inprogress/candidate',
    reviewerStatus: 'Pending With Reviewer',
    listPageReadyText: 'Candidate List',
    // Show this many candidates per page before scanning the table.
    pageSize: 100,
    // The first selector matching a candidate list row is used. Adjust only if needed.
    rowSelector: 'tr, [role="row"]',
    // Must point to the clickable candidate name/link inside a row. Do not use a checkbox.
    openCandidateSelector: 'a, [role="link"]',
    detailsPageReadyText: 'Onboarding Documents',
    viewActionText: 'View',
    documentsSectionText: 'Documents Upload',
    documentPageReadyText: 'Documents Upload',
    missingText: 'No file chosen',
    // Candidate ID is the TR_* value shown under the name, e.g. TR_40122.
    employeeIdRegex: 'TR_\\d+',
    requiredDocuments: [
      'Pan Card',
      'Aadhar Card',
      'Experience/Relieving Letter',
      'Full and final settlement letter',
      'Payslips',
      '10th Certificate',
      '12th Marksheet',
      'Graduation Completion Certificate',
      'All mark sheets (graduation certificate)',
      'Passport size photo',
      'Cancel Cheque/Bank statement/passbook first page',
      'Last increment Letter (if any)',
      'Last three months payslips',
      'Experience or Relieving letter from last company (if any working)',
      'SSC Passed'
    ]
  },

  sheets: {
    // Paste the URL of the existing "Document Tracker" sheet here.
    url: 'https://docs.google.com/spreadsheets/d/PASTE_YOUR_SHEET_ID_HERE/edit',
    tabName: 'Document Tracker',
    headerRow: 1,
    // These column numbers match the sheet in the screenshot. Add/change labels as required.
    columns: {
      employeeId: 1,
      employeeName: 2,
      'Aadhar Card': 4,
      'Pan Card': 5,
      'Passport size photo': 6,
      '10th Certificate': 7,
      '12th Marksheet': 8,
      'Graduation Completion Certificate': 9,
      'Cancel Cheque/Bank statement/passbook first page': 10,
      'Experience/Relieving Letter': 11,
      'Offer Letter': 12,
      totalFiles: 13,
      status: 14,
      error: 15,
      processedDate: 16,
      Payslips: 17,
      'Full and final settlement letter': 18,
      'All mark sheets (graduation certificate)': 19,
      'Last increment Letter (if any)': 20,
      'Last three months payslips': 21,
      'Experience or Relieving letter from last company (if any working)': 22,
      'SSC Passed': 23
    }
  }
};
