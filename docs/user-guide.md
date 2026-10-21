# ProofTrack — User & Operations Guide

## 1. Dispatch Manager Workflow (`MANAGER` & `ADMIN`)

### Monitoring the Operations Dashboard (`/manager/dashboard`)
- **KPI Overview**: View live counts of Total, Delivered, In Transit, Assigned, Pending, Failed, and Overdue deliveries alongside overall completion percentage.
- **Attention Queues**: Switch between **Overdue**, **Failed**, **Flagged Proofs**, **Unassigned**, and **Recently Completed** tabs. Click any row to open the Delivery Inspection Drawer.

### Creating, Importing & Assigning Deliveries (`/manager/deliveries`)
1. **Single Delivery Creation**: Click **Create Delivery**, fill in recipient name, US phone, street address, city, 2-letter US state, 5-digit ZIP, scheduled date, optional delivery window, and instructions. You may assign an active driver immediately (creating in `ASSIGNED` state) or leave unassigned (`PENDING`).
2. **CSV Bulk Import**:
   - Click **Bulk Import CSV** and download the **Template CSV** if needed.
   - Select your UTF-8 `.csv` manifest. ProofTrack automatically runs a dry-run validation preview showing total, valid, and invalid rows with line-by-line error messages.
   - Click **Import Deliveries** to commit all validated shipments in a single transaction.
3. **Assigning / Reassigning Drivers**: Open any delivery row to launch the **Delivery Detail Drawer**, choose an active driver from the **Select Active Driver** dropdown, optionally adjust the scheduled date, and click **Assign Driver** / **Update Assignment**.

### Inspecting Proof of Delivery & Handling Exceptions
- In the **Delivery Detail Drawer**, scroll to **Proof-of-Delivery Photographs**:
  - Click any thumbnail to open the high-resolution **Proof of Delivery Verification** lightbox showing SHA-256 digest, pixel dimensions, file size, upload timestamp, and optional GPS coordinates.
  - Click **Flag** to mark a questionable proof photo for investigation (requires a written reason).
  - Click **Resolve** once a flagged proof investigation has been cleared.
- **Reopening Deliveries**: If a `DELIVERED`, `FAILED`, or `CANCELED` shipment requires another attempt, click **Reopen Delivery** in the drawer and supply a mandatory audit reason.

---

## 2. Field Driver Mobile Workflow (`DRIVER`)

### Viewing Your Route (`/driver`)
1. Sign in on your mobile browser using your driver credentials.
2. Your **Route Summary** displays live counts for Assigned, In Transit, Completed, and Failed stops.
3. Toggle between **All Assigned** and **Today & Overdue**, filter by status, or search by tracking reference, recipient name, street, or ZIP code.

### Completing a Delivery with Photo Proof (`/driver/deliveries/:id`)
1. Tap a delivery card to open its stop details. Use **Navigate in Maps** to launch turn-by-turn directions or **Call Recipient** to dial the customer.
2. Tap **Start Delivery (Mark In Transit)** when heading to the drop-off location.
3. Under **Proof of Delivery (Required)**:
   - Tap **Take Photo** to open your phone's rear camera or **Choose from Device** to attach up to 5 photos (`JPEG`, `PNG`, `WebP`, `HEIC`, max 10 MB each).
   - Inspect the thumbnail preview; tap **Remove** if you need to retake a blurry shot.
   - Optionally enter the name of the person who received the parcel (`Received By`), add delivery notes, or check **Share GPS coordinates with this proof**.
4. Tap **Submit Proof & Mark Delivered**. A progress bar tracks the upload, and the delivery status transitions to **Delivered** only after the server confirms storage and database persistence.

### Offline Queue Resilience
- If mobile reception drops during submission, ProofTrack saves the pending proof photo and `idempotency_key` into your device's IndexedDB queue and displays an amber **queued for sync** banner in the top header.
- The delivery is **never** falsely shown as `DELIVERED` while queued offline. Once connectivity returns, ProofTrack automatically syncs (or you can tap **Sync Now**).

### Reporting a Failed Attempt
- If you cannot complete the stop, tap **Unable to Deliver? Report Failed Attempt**, choose the structured reason (e.g., `Recipient Unavailable`, `Access Denied / Gate Locked`), enter notes, optionally attach a photo of the gate/notice, and tap **Confirm Failed Attempt**.

---

## 3. Administrator Guide (`ADMIN`)

- **Users & Drivers (`/admin/users`)**: Create new `DRIVER`, `MANAGER`, or `ADMIN` accounts, edit contact details, deactivate accounts (which immediately revokes their active sessions and blocks new assignments), or click **Reset PW** to issue a temporary password that forces a password change at next login.
- **System Settings (`/admin/settings`)**: Update the organization name, change the US business timezone used for daily KPI and overdue calculations, adjust proof retention days, or run **Storage Orphan Reconciliation**.
