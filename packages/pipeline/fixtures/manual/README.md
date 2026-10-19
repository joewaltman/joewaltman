# Manual drop samples

No real file has arrived yet for the Secretary of State, UCC, Labor Commissioner, County Recorder or
fictitious business name sources, so `src/drops/drops.test.ts` uses small synthetic rows with made-up
business names. When the first real file for a source is uploaded, save a few rows here with every
person's name and street address replaced by REDACTED, point the tests at it, and set that source's
`verify` to false in `content/manual-drops.json`.

The DCA Dental Board fixture (`../dca/DentalBoard_Data00.xlsx`) is real rows from DCA's file with the
individual licensee redacted and practice names that included a dentist's personal name trimmed to
the practice part.
