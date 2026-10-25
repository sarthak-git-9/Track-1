/* Shared synthetic statement for the Add screen and test corpus. */
(function (root) {
  'use strict';
  const sample = `SAMPLE BANK STATEMENT (synthetic)
Account Holder: Rahul Sharma
A/c No: 50100234567890   IFSC: HDFC0001234
DOB: 12/04/1999   PAN: ABCDE1234F
Phone: +91 98765 43210   Email: rahul.sharma@example.com
Landlord: Meera Kulkarni, 14 MG Road, Pune

01 Oct  UPI/412345678901/Rahul S/rahul@okaxis      Rs 4,200.00
03 Oct  UPI-Sharma Jewellers-9876                   Rs 15,000.00
05 Oct  paid to Priya Nair                          Rs 500.00
09 Oct  Salary credit                               Rs 52,000.00`;
  if (typeof module !== 'undefined' && module.exports) module.exports = sample;
  else root.BharosaSample = sample;
})(typeof self !== 'undefined' ? self : this);
