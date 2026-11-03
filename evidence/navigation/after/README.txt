Navigation audit of the homepage change (branch fix/one-homepage-and-brand), run with scripts/nav-audit.mjs and scripts/page-shots.mjs against a local production build with the test-tone provider (no real speech, no real keys).

before/  the code at main 010c822: findings.json lists, for a fresh visitor and a returning guest, the headline of / and /demo and where "Create an announcement" led (/demo, a second introduction).
after/   this branch: / is the only homepage, /demo redirects to it, the button opens the editor (fresh) or a new announcement (returning guest), every section link lands under the header.
Page overflow was measured at 320, 375, 390, 768, 1024, 1280 and 1440 px in light and dark for / and at 320, 390 and 1440 for /signin: 0 px everywhere. Only a subset of the full-page screenshots is kept here to limit the repository's size.
