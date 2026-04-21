BuleSky-PJC

Globe data upload:
`npm --prefix functions run upload:globe-data`

Optional reset before reimport:
`npm --prefix functions run upload:globe-data -- --reset`

Build organization submissions into review queue:
`npm --prefix functions run queue:organization-events`

Optional reset before rebuilding the review queue:
`npm --prefix functions run queue:organization-events -- --reset`
