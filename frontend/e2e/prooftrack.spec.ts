import { test, expect } from "@playwright/test";

// Valid 1x1 RGB PNG buffer for proof-of-delivery photo upload
const VALID_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("ProofTrack End-to-End Logistics & Proof-of-Delivery Suite", () => {
  test("1. Unauthenticated access redirects to login and rejects invalid credentials", async ({
    page,
  }) => {
    await page.goto("/manager/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.fill("#login-email", "manager@prooftrack.test");
    await page.fill("#login-password", "WrongPassword123!");
    await page.click('[data-testid="login-submit"]');

    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("2. Full Manager -> Driver -> Photo Upload -> Delivery Confirmation -> Manager Proof Review workflow", async ({
    page,
  }) => {
    const uniqueSuffix = Date.now().toString().slice(-6);
    const customRef = `PT-E2E-${uniqueSuffix}`;
    const recipientName = `Jordan E2E-${uniqueSuffix}`;

    // --- STEP A: Manager signs in and creates + assigns a delivery ---
    await page.goto("/login");
    await page.click('[data-testid="demo-manager-btn"]');
    await page.click('[data-testid="login-submit"]');

    await expect(page).toHaveURL(/\/manager\/dashboard$/);
    await expect(page.getByTestId("dashboard-kpi-grid")).toBeVisible();

    // Navigate to Deliveries & Dispatch
    await page.click('[data-testid="nav-deliveries"]');
    await expect(page).toHaveURL(/\/manager\/deliveries$/);

    // Open Create Delivery modal
    await page.click('[data-testid="open-create-delivery-btn"]');
    await page.fill('[data-testid="create-recipient-name"]', recipientName);
    await page.fill('[data-testid="create-recipient-phone"]', "512-555-0199");
    await page.fill('[data-testid="create-address1"]', "500 W 2nd St");
    await page.fill('[data-testid="create-address2"]', "Suite 1900");
    await page.fill('[data-testid="create-city"]', "Austin");
    await page.selectOption('[data-testid="create-state"]', "TX");
    await page.fill('[data-testid="create-zip"]', "78701");
    await page.fill('[data-testid="create-reference"]', customRef);
    await page.fill(
      '[data-testid="create-instructions"]',
      "Leave package with reception security desk."
    );

    // Select driver1@prooftrack.test from the dropdown
    const driverSelect = page.getByTestId("create-driver-select");
    const driver1Option = await driverSelect
      .locator("option", { hasText: "driver1@prooftrack.test" })
      .getAttribute("value");
    expect(driver1Option).toBeTruthy();
    await driverSelect.selectOption(driver1Option!);

    await page.click('[data-testid="submit-create-delivery-btn"]');

    // The inspection drawer opens automatically for the created delivery
    await expect(page.getByTestId("delivery-detail-drawer")).toBeVisible();
    await expect(page.getByTestId("drawer-delivery-reference")).toHaveText(
      customRef
    );
    await page.click('[data-testid="close-drawer-btn"]');

    // Verify the row is visible in the manager table with ASSIGNED status
    const row = page.getByTestId(`delivery-row-${customRef}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("status-badge-ASSIGNED")).toBeVisible();

    // Manager logs out
    await page.click('[data-testid="manager-logout-btn"]');
    await expect(page).toHaveURL(/\/login$/);

    // --- STEP B: Driver logs in on mobile, starts delivery, uploads photo proof, completes delivery ---
    await page.click('[data-testid="demo-driver1-btn"]');
    await page.click('[data-testid="login-submit"]');

    await expect(page).toHaveURL(/\/driver$/);

    // RBAC check: Driver attempting to visit /manager/dashboard is redirected back to /driver
    await page.goto("/manager/dashboard");
    await expect(page).toHaveURL(/\/driver$/);

    // Search for the newly assigned delivery
    await page.fill('[data-testid="driver-search-input"]', customRef);
    const driverCard = page.getByTestId(`driver-delivery-card-${customRef}`);
    await expect(driverCard).toBeVisible();
    await driverCard.click();

    await expect(page.getByTestId("driver-detail-recipient")).toHaveText(
      recipientName
    );

    // Start the delivery (ASSIGNED -> IN_TRANSIT)
    await page.click('[data-testid="start-delivery-btn"]');
    await expect(page.getByTestId("status-badge-IN_TRANSIT")).toBeVisible();

    // Verify that attempting to complete without a photo shows an inline validation error
    await page.click('[data-testid="complete-delivery-submit-btn"]');
    await expect(page.getByTestId("pod-error-alert")).toContainText(
      "At least one proof-of-delivery photo is required"
    );

    // Select a valid proof-of-delivery photo
    const fileInput = page.getByTestId("pod-file-input");
    await fileInput.setInputFiles({
      name: `${customRef.toLowerCase()}-doorstep.png`,
      mimeType: "image/png",
      buffer: VALID_PNG_BUFFER,
    });

    await expect(page.getByTestId("selected-photo-previews")).toBeVisible();

    // Fill optional recipient confirmation and driver notes
    await page.fill('[data-testid="pod-recipient-input"]', "Front Desk - Alex");
    await page.fill(
      '[data-testid="pod-notes-input"]',
      "Delivered intact at reception desk."
    );

    // Submit proof & mark delivered
    await page.click('[data-testid="complete-delivery-submit-btn"]');

    // Wait for completion confirmation banner and DELIVERED badge
    await expect(
      page.getByTestId("driver-delivery-completed-banner")
    ).toBeVisible();
    await expect(page.getByTestId("status-badge-DELIVERED")).toBeVisible();
    await expect(page.getByTestId("driver-uploaded-proofs")).toBeVisible();

    // Driver logs out
    await page.click('[data-testid="driver-logout-btn"]');
    await expect(page).toHaveURL(/\/login$/);

    // --- STEP C: Manager logs back in, verifies DELIVERED status and inspects uploaded proof photo ---
    await page.click('[data-testid="demo-manager-btn"]');
    await page.click('[data-testid="login-submit"]');

    await page.click('[data-testid="nav-deliveries"]');
    await page.fill('[data-testid="manager-search-input"]', customRef);

    const updatedRow = page.getByTestId(`delivery-row-${customRef}`);
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow.getByTestId("status-badge-DELIVERED")).toBeVisible();
    await expect(page.getByTestId(`proof-badge-${customRef}`)).toContainText(
      "1 photo"
    );

    // Open inspection drawer
    await page.click(`[data-testid="inspect-btn-${customRef}"]`);
    const drawer = page.getByTestId("delivery-detail-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("status-badge-DELIVERED")).toBeVisible();

    // Verify proof thumbnail card is rendered and open full-size lightbox
    const proofsSection = drawer.getByTestId("drawer-proofs-section");
    await expect(proofsSection).toContainText(
      "Proof-of-Delivery Photographs (1)"
    );

    const lightboxBtn = proofsSection.locator(
      '[data-testid^="open-proof-lightbox-"]'
    );
    await lightboxBtn.click();

    const fullImg = page.getByTestId("lightbox-proof-image");
    await expect(fullImg).toBeVisible();
  });

  test("3. Administrator can manage users and system settings", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.click('[data-testid="demo-admin-btn"]');
    await page.click('[data-testid="login-submit"]');

    await expect(page).toHaveURL(/\/manager\/dashboard$/);

    // Navigate to Users & Drivers
    await page.click('[data-testid="nav-admin-users"]');
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(
      page.getByTestId("user-row-driver1@prooftrack.test")
    ).toBeVisible();

    // Navigate to System Settings
    await page.click('[data-testid="nav-admin-settings"]');
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await page.click('[data-testid="reconcile-storage-btn"]');
    await expect(page.getByText("Reconciliation Report:")).toBeVisible();
  });
});
