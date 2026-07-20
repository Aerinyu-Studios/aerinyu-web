AERINYU QA TESTER PAGE

Files:
- qa-testers.html
- qa-testers.css
- qa-testers.js
- updated index.html
- updated careers.html
- updated vercel.json

Setup:
1. Add qa-testers.html, qa-testers.css and qa-testers.js to the project root.
2. Replace the existing index.html, careers.html and vercel.json with the included versions.
3. In Careers Admin, create an OPEN job whose title includes either:
   - QA
   - Quality Assurance
   Example: Quality Assurance Tester
4. The page automatically finds that job through /api/jobs and submits applications to the existing /api/applications endpoint.
5. The applicant's QA-specific answers are combined into the existing application "message" field, so no database migration is required.
6. The existing résumé upload and Cloudflare Turnstile flow are reused.
