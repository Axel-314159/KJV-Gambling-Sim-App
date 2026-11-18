# KJV Gambling Simulator Web Application
### [v0.0.0](https://semver.org)

## Setting up Local Development Server

### Install Dependencies
* `postgresql`
* `postgresql-contrib`
* `build-essential`
* Node.js (version >= 26.6.6)

### Setup Fresh Database

Run `backend/scripts/setup-staging-db.sh` once to set up the PostgreSQL database.

### Populate your database with bible verses
`$ npm run seed:kjv`

### Create yourself a local admin user
`$ npm run create:admin <username> email@example.com "<password>"`

## Running the server locally
Within `backend/`:
`$ npm run dev`

Within `frontend/`:
`$ npm run dev`

Site will be at http://localhost:5173