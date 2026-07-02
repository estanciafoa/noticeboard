# Display status heartbeat

The admin panel's **Displays** button shows whether each TV is alive. Because the
displays sit on the local network (the admin can't reach them directly), each
display *phones home* a small heartbeat. This folder holds the tiny serverless
backend that collects those heartbeats.

## How it works

```
 display (index.html?t=t1c1)  ──POST heartbeat──►  Apps Script Web App ──►  Google Sheet
 admin panel (Displays modal) ──GET  status ─────►  Apps Script Web App ◄──  (1 row per TV)
```

- A display POSTs `{ tv, online, slides, version, href, ua }` on boot and on
  every config refresh (~every `refreshInterval` minutes, default 15).
- The admin panel GETs the latest row per display and marks any display with **no
  heartbeat in ~35 minutes** as offline (red dot). A display that is powered off
  or has lost internet simply stops reporting, which is exactly what red means.

## One-time setup

The target spreadsheet is hardcoded in [`Code.gs`](Code.gs) as `SPREADSHEET_ID`
(`1KMoADnda8lw-r1Qq3UO9BUn2ueSenrYoahMKlNZmRnE`). The Google account that runs
the script must have edit access to that sheet.

1. Open that spreadsheet (or any spreadsheet you own) → **Extensions → Apps
   Script**. Delete the sample code, paste in [`Code.gs`](Code.gs), and **Save**.
   (Because the sheet is referenced by ID via `openById`, a standalone Apps
   Script project works too — it doesn't need to be bound to the sheet.)
2. **Deploy → New deployment → Web app**:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - Click **Deploy**, authorise the permissions, and copy the **Web app URL**
     (it ends in `/exec`).
3. Open the admin panel → **Displays** → paste the URL into **Backend URL** →
   **Save**. (It is stored in `config.json` as `heartbeatUrl` and picked up by
   every display on its next refresh.)

The displays start reporting within one refresh cycle. You can also open the
Sheet directly to eyeball the raw rows.

## Updating the script later

Apps Script → **Deploy → Manage deployments → ✏️ edit → Version: New → Deploy.**
The `/exec` URL stays the same, so nothing in the repo needs to change.

## Notes

- Heartbeats use a `text/plain` body so the browser sends them without a CORS
  preflight (which Apps Script can't answer). The script parses the JSON itself.
- The offline threshold (35 min) lives in `js/status.js` (`STALE_MS`).
- Local dev (`localhost`) and unassigned displays (no `?t=`) do **not** send
  heartbeats, so testing never pollutes the status list.
