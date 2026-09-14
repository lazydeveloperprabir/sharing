export default {
  // Keep this true until the console output has been verified on one candidate.
  dryRun: true,

  darwinbox: {
    candidateListUrl: 'https://YOUR-COMPANY.darwinbox.in/ms/onboarding/inprogress/candidate',
    reviewerStatus: 'Pending With Reviewer',
    // The first selector matching a candidate list row is used. Adjust only if needed.
    rowSelector: 'tr, [role="row"]',
    // Must point to the clickable candidate name/link inside a row. Do not use a checkbox.
    openCandidateSelector: 'a, [role="link"]',
    documentPageReadyText: 'Documents',
    missingText: 'No file chosen',
    // Change this if your Employee IDs have a different form.
    employeeIdRegex: '[A-Za-z]{2,}[_-]\\d+',
    requiredDocuments: [
      'Pan Card',
      'Aadhar Card',
      '10th Certificate',
      '12th Certificate',
      'Degree Certificate',
      'Bank Details',
      'Experience/Relieving Letter',
      'Offer Letter'
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
      Resume: 6,
      '10th Certificate': 7,
      '12th Certificate': 8,
      'Degree Certificate': 9,
      'Bank Details': 10,
      'Experience/Relieving Letter': 11,
      'Offer Letter': 12,
      totalFiles: 13,
      status: 14,
      error: 15,
      processedDate: 16
    }
  }
};
