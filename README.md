# PANTaU

**P**emantauan **A**ktiviti **N**adi dan **T**ek**A**nan dalam **U**nit

A web-based personal health vitals monitoring and record management system for tracking blood pressure, pulse oximetry and blood glucose readings.

---

## Overview

PANTaU allows users to log vitals readings alongside contextual notes, keep a timestamped history, and print or export reports for personal or clinical reference. An administrative view for oversight of registered user records is planned.

---

## Core Features

### Authentication & User Profiling
* **IC Registration:** Captures Name, IC Number, and PIN with duplicate account detection. IC numbers are stored without dashes. A new account goes straight to the user page; an already registered IC is sent to Log In.
* **Automated Demographic Derivation:** Automatically extracts the user's birth date and gender from the IC number on the backend during sign-up. Age is calculated when displayed.
* **Role-Based Accounts:** Accounts carry a `user` or `admin` role. The User Dashboard is available now; the Admin Dashboard is planned.
* **Offline Fallback:** Detects connection loss and serves a dedicated offline screen with a retry button.

### Vitals Logging (User Dashboard)
* **Multi-Device Input:** The **+ Add Reading** button lets the user choose a device. Several devices can be added to one submission (each device once):
  * **Oximeter:** `SpO2` and `Oximeter BPM`
  * **Blood Pressure Monitor:** Reading 1 (`Systolic`, `Diastolic`, `BP BPM`) and an optional Reading 2, taken about 1 minute later
  * **Blood Glucose Monitor:** glucose level in `mmol/L` or `mg/dL`
* **1-Minute Countdown:** Starts when Reading 1 is saved. It is a reminder only and never blocks submitting.
* **Save for Now:** Each device card can keep its reading temporarily in the browser, so the user can wait for the countdown and finish later. Nothing is sent to the database until Submit.
* **Contextual Notes (Optional):** Choose a preset (*Before Eating*, *After Eating*, *Fasting*, *Sleeping*, *Woke Up Early Morning*, *Lying Down*, *Sitting*, *Relaxing*, *Walking*, *Running*) or type a custom note.
* **Automatic Timestamping:** The date and time are recorded automatically and shown in Malaysia time (UTC+8).

### History & Reporting
* **Personal History Log:** Shows every submission, newest first, with date, time, all device readings and the note. A table on computers and cards on phones.
* **Auto Refresh:** Data refreshes after saving, when returning to the page, every minute, and with a Refresh button.
* **Print & PDF Export:** A fixed A4 landscape table layout that looks the same on every device.

### Administrative Oversight (Planned)
* **User Directory:** List registered users with database error handling.
* **Record Inspection:** View an individual user's vitals history and export it to PDF.

---

## System Architecture

The application follows a 3-level processing flow:

1. **Level 1 — Input:** Network checks, registration/login credentials, vitals form submissions, and report triggers.
2. **Level 2 — Database Process:** Input validation, duplicate IC verification, birth date/gender derivation, automatic timestamping, and queries.
3. **Level 3 — Output:** Dynamic UI views, validation alerts, history tables, and print/PDF output.

---

## Tech Stack

* **Frontend:** HTML, CSS, JavaScript
* **Backend:** Cloudflare Workers
* **Database:** Cloudflare D1 (SQLite)

---

## Database Schema (Overview)

* **`users`**: Stores `id`, `ic` (unique), `name`, `pin_hash`, `pin_salt`, `birth_date`, `gender`, `role`, and `created_at`.
* **`readings`**: One row per submission, linked to a user by `user_id`. Stores the blood pressure Reading 1 and Reading 2, oximeter, glucose value and unit, `note`, `measured_at` and `created_at`.
* **`sessions`**: Stores log-in sessions linked to `users`.

Full definitions are in `schema.sql`.

---

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd PANTaU
   ```
2. Create a D1 database and put its name and `database_id` in `wrangler.json`:
   ```bash
   npx wrangler d1 create pantau-database
   ```
3. Create the tables:
   ```bash
   npx wrangler d1 execute pantau-database --remote --file=schema.sql
   ```
4. Run locally, then deploy:
   ```bash
   npx wrangler dev --remote
   npx wrangler deploy
   ```
