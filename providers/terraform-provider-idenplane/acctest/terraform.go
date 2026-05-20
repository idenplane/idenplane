package acctest

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/idenplane/terraform-provider-idenplane/idenplane"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/acctest"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/hashicorp/terraform-plugin-sdk/v2/terraform"
)

// TestAccRealm_basic tests basic realm creation and management.
func TestAccRealm_basic(t *testing.T) {
	t.Parallel()

RealmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)
	displayName := fmt.Sprintf("Test Realm %s", RealmName)
	updatedDisplayName := fmt.Sprintf("Updated %s", displayName)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRealmDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRealmConfig(RealmName, displayName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttrSet("idenplane_realm.test", "id"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "name", RealmName),
					resource.TestCheckResourceAttr("idenplane_realm.test", "display_name", displayName),
					resource.TestCheckResourceAttr("idenplane_realm.test", "enabled", "true"),
				),
			},
			{
				Config: testAccRealmConfigUpdated(RealmName, updatedDisplayName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "name", RealmName),
					resource.TestCheckResourceAttr("idenplane_realm.test", "display_name", updatedDisplayName),
				),
			},
			{
				ResourceName:      "idenplane_realm.test",
				ImportState:       true,
				ImportStateVerify:  true,
				ImportStateIdPrefix: RealmName + "/",
			},
		},
	})
}

// TestAccRealm_withPasswordPolicy tests realm creation with password policies.
func TestAccRealm_withPasswordPolicy(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRealmDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRealmConfigWithPasswordPolicy(realmName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "password_min_length", "12"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "password_require_uppercase", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "password_require_lowercase", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "password_require_digits", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "password_require_special_chars", "true"),
				),
			},
		},
	})
}

// TestAccRealm_withBruteForceProtection tests realm creation with brute force protection.
func TestAccRealm_withBruteForceProtection(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRealmDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRealmConfigWithBruteForceProtection(realmName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "brute_force_enabled", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "max_login_failures", "3"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "lockout_duration", "1800"),
				),
			},
		},
	})
}

// TestAccRealm_withMFASettings tests realm creation with MFA settings.
func TestAccRealm_withMFASettings(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRealmDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRealmConfigWithMFA(realmName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "mfa_required", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "webauthn_enabled", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "adaptive_auth_enabled", "true"),
				),
			},
		},
	})
}

// TestAccRealm_withRateLimiting tests realm creation with rate limiting.
func TestAccRealm_withRateLimiting(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRealmDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRealmConfigWithRateLimiting(realmName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "rate_limit_enabled", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "client_rate_limit_per_minute", "100"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "ip_rate_limit_per_minute", "30"),
				),
			},
		},
	})
}

// TestAccRealm_requiresEmailVerification tests realm with email verification settings.
func TestAccRealm_requiresEmailVerification(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRealmDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRealmConfigWithEmailVerification(realmName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "require_email_verification", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "registration_approval_required", "true"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "allowed_email_domains.#", "2"),
				),
			},
		},
	})
}

// TestAccRealm_withSMTPSettings tests realm creation with SMTP settings.
func TestAccRealm_withSMTPSettings(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRealmDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRealmConfigWithSMTP(realmName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "smtp_host", "smtp.example.com"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "smtp_port", "587"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "smtp_from", "noreply@example.com"),
					resource.TestCheckResourceAttr("idenplane_realm.test", "smtp_secure", "false"),
				),
			},
		},
	})
}

// TestAccClient_basic tests basic client creation and management.
func TestAccClient_basic(t *testing.T) {
	t.Parallel()

	// First create a realm to use as the parent
	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)
	clientID := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckClientDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccClientConfig(realmName, clientID),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					testAccCheckClientExists("idenplane_client.test"),
					resource.TestCheckResourceAttrSet("idenplane_client.test", "id"),
					resource.TestCheckResourceAttr("idenplane_client.test", "client_id", clientID),
					resource.TestCheckResourceAttr("idenplane_client.test", "enabled", "true"),
				),
			},
			{
				ResourceName:      "idenplane_client.test",
				ImportState:       true,
				ImportStateVerify: true,
			},
		},
	})
}

// TestAccClient_withRedirectURIs tests client creation with redirect URIs.
func TestAccClient_withRedirectURIs(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)
	clientID := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckClientDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccClientConfigWithRedirectURIs(realmName, clientID),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckClientExists("idenplane_client.test"),
					resource.TestCheckResourceAttr("idenplane_client.test", "redirect_uris.#", "2"),
				),
			},
		},
	})
}

// TestAccRole_basic tests basic role creation and management.
func TestAccRole_basic(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)
	roleName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckRoleDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccRoleConfig(realmName, roleName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					testAccCheckRoleExists("idenplane_role.test"),
					resource.TestCheckResourceAttrSet("idenplane_role.test", "id"),
					resource.TestCheckResourceAttr("idenplane_role.test", "name", roleName),
				),
			},
			{
				ResourceName:      "idenplane_role.test",
				ImportState:       true,
				ImportStateVerify: true,
			},
		},
	})
}

// TestAccGroup_basic tests basic group creation and management.
func TestAccGroup_basic(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)
	groupName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckGroupDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccGroupConfig(realmName, groupName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					testAccCheckGroupExists("idenplane_group.test"),
					resource.TestCheckResourceAttrSet("idenplane_group.test", "id"),
					resource.TestCheckResourceAttr("idenplane_group.test", "name", groupName),
				),
			},
			{
				ResourceName:      "idenplane_group.test",
				ImportState:       true,
				ImportStateVerify: true,
			},
		},
	})
}

// TestAccIdentityProvider_basic tests basic identity provider creation.
func TestAccIdentityProvider_basic(t *testing.T) {
	t.Parallel()

	realmName := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)
	idpAlias := acctest.RandStringFromCharSet(8, acctest.CharSetAlphaNum)

	resource.Test(t, resource.TestCase{
		PreCheck: func() {
			testAccPreCheck(t)
		},
		ProviderFactories: testProviderFactories(),
		CheckDestroy:      testAccCheckIdentityProviderDestroy,
		Steps: []resource.TestStep{
			{
				Config: testAccIdentityProviderConfig(realmName, idpAlias),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("idenplane_realm.test"),
					testAccCheckIdentityProviderExists("idenplane_identity_provider.test"),
					resource.TestCheckResourceAttrSet("idenplane_identity_provider.test", "id"),
					resource.TestCheckResourceAttr("idenplane_identity_provider.test", "alias", idpAlias),
				),
			},
			{
				ResourceName:      "idenplane_identity_provider.test",
				ImportState:       true,
				ImportStateVerify: true,
			},
		},
	})
}

// Helper functions

func testAccPreCheck(t *testing.T) {
	if v := os.Getenv("IDENPLANE_BASE_URL"); v == "" {
		t.Skip("IDENPLANE_BASE_URL is not set; acceptance tests skipped")
	}
}

func testProviderFactories() map[string]func() (*terraform.ResourceProvider, error) {
	return map[string]func() (*terraform.ResourceProvider, error){
		"idenplane": func() (*terraform.ResourceProvider, error) {
			return Provider(), nil
		},
	}
}

func testAccCheckRealmExists(n string) resource.TestCheckFunc {
	return func(s *terraform.State) error {
		rs, ok := s.RootModule().Resources[n]
		if !ok {
			return fmt.Errorf("not found: %s", n)
		}

		if rs.Primary.ID == "" {
			return fmt.Errorf("realm ID is not set")
		}

		client := testAccProvider.Meta().(*providerConfigure).Client
		_, err := NewRealmClient(client).Get(context.Background(), rs.Primary.ID)
		if err != nil {
			return fmt.Errorf("failed to get realm: %w", err)
		}

		return nil
	}
}

func testAccCheckRealmDestroy(s *terraform.State) error {
	client := testAccProvider.Meta().(*providerConfigure).Client
	realmClient := NewRealmClient(client)

	for _, rs := range s.RootModule().Resources {
		if rs.Type != "idenplane_realm" {
			continue
		}

		_, err := realmClient.Get(context.Background(), rs.Primary.ID)
		if err == nil {
			return fmt.Errorf("realm %s still exists", rs.Primary.ID)
		}

		if !isNotFoundError(err) {
			return fmt.Errorf("unexpected error checking realm destruction: %w", err)
		}
	}

	return nil
}

func testAccCheckClientExists(n string) resource.TestCheckFunc {
	return func(s *terraform.State) error {
		rs, ok := s.RootModule().Resources[n]
		if !ok {
			return fmt.Errorf("not found: %s", n)
		}

		if rs.Primary.ID == "" {
			return fmt.Errorf("client ID is not set")
		}

		client := testAccProvider.Meta().(*providerConfigure).Client
		_, err := NewClientServiceClient(client).Get(context.Background(), rs.Primary.ID)
		if err != nil {
			return fmt.Errorf("failed to get client: %w", err)
		}

		return nil
	}
}

func testAccCheckClientDestroy(s *terraform.State) error {
	client := testAccProvider.Meta().(*providerConfigure).Client
	clientService := NewClientServiceClient(client)

	for _, rs := range s.RootModule().Resources {
		if rs.Type != "idenplane_client" {
			continue
		}

		_, err := clientService.Get(context.Background(), rs.Primary.ID)
		if err == nil {
			return fmt.Errorf("client %s still exists", rs.Primary.ID)
		}

		if !isNotFoundError(err) {
			return fmt.Errorf("unexpected error checking client destruction: %w", err)
		}
	}

	return nil
}

func testAccCheckRoleExists(n string) resource.TestCheckFunc {
	return func(s *terraform.State) error {
		rs, ok := s.RootModule().Resources[n]
		if !ok {
			return fmt.Errorf("not found: %s", n)
		}

		if rs.Primary.ID == "" {
			return fmt.Errorf("role ID is not set")
		}

		client := testAccProvider.Meta().(*providerConfigure).Client
		_, err := NewRoleClient(client).Get(context.Background(), rs.Primary.ID)
		if err != nil {
			return fmt.Errorf("failed to get role: %w", err)
		}

		return nil
	}
}

func testAccCheckRoleDestroy(s *terraform.State) error {
	client := testAccProvider.Meta().(*providerConfigure).Client
	roleClient := NewRoleClient(client)

	for _, rs := range s.RootModule().Resources {
		if rs.Type != "idenplane_role" {
			continue
		}

		_, err := roleClient.Get(context.Background(), rs.Primary.ID)
		if err == nil {
			return fmt.Errorf("role %s still exists", rs.Primary.ID)
		}

		if !isNotFoundError(err) {
			return fmt.Errorf("unexpected error checking role destruction: %w", err)
		}
	}

	return nil
}

func testAccCheckGroupExists(n string) resource.TestCheckFunc {
	return func(s *terraform.State) error {
		rs, ok := s.RootModule().Resources[n]
		if !ok {
			return fmt.Errorf("not found: %s", n)
		}

		if rs.Primary.ID == "" {
			return fmt.Errorf("group ID is not set")
		}

		client := testAccProvider.Meta().(*providerConfigure).Client
		_, err := NewGroupClient(client).Get(context.Background(), rs.Primary.ID)
		if err != nil {
			return fmt.Errorf("failed to get group: %w", err)
		}

		return nil
	}
}

func testAccCheckGroupDestroy(s *terraform.State) error {
	client := testAccProvider.Meta().(*providerConfigure).Client
	groupClient := NewGroupClient(client)

	for _, rs := range s.RootModule().Resources {
		if rs.Type != "idenplane_group" {
			continue
		}

		_, err := groupClient.Get(context.Background(), rs.Primary.ID)
		if err == nil {
			return fmt.Errorf("group %s still exists", rs.Primary.ID)
		}

		if !isNotFoundError(err) {
			return fmt.Errorf("unexpected error checking group destruction: %w", err)
		}
	}

	return nil
}

func testAccCheckIdentityProviderExists(n string) resource.TestCheckFunc {
	return func(s *terraform.State) error {
		rs, ok := s.RootModule().Resources[n]
		if !ok {
			return fmt.Errorf("not found: %s", n)
		}

		if rs.Primary.ID == "" {
			return fmt.Errorf("identity provider ID is not set")
		}

		client := testAccProvider.Meta().(*providerConfigure).Client
		_, err := NewIdentityProviderClient(client).Get(context.Background(), rs.Primary.ID)
		if err != nil {
			return fmt.Errorf("failed to get identity provider: %w", err)
		}

		return nil
	}
}

func testAccCheckIdentityProviderDestroy(s *terraform.State) error {
	client := testAccProvider.Meta().(*providerConfigure).Client
	idpClient := NewIdentityProviderClient(client)

	for _, rs := range s.RootModule().Resources {
		if rs.Type != "idenplane_identity_provider" {
			continue
		}

		_, err := idpClient.Get(context.Background(), rs.Primary.ID)
		if err == nil {
			return fmt.Errorf("identity provider %s still exists", rs.Primary.ID)
		}

		if !isNotFoundError(err) {
			return fmt.Errorf("unexpected error checking identity provider destruction: %w", err)
		}
	}

	return nil
}

// Terraform configurations for tests

func testAccRealmConfig(realmName, displayName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name         = "%s"
  display_name = "%s"
  enabled      = true
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName, displayName)
}

func testAccRealmConfigUpdated(realmName, displayName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name         = "%s"
  display_name = "%s"
  enabled      = true
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName, displayName)
}

func testAccRealmConfigWithPasswordPolicy(realmName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name                            = "%s"
  display_name                    = "Password Policy Test"
  enabled                         = true
  password_min_length             = 12
  password_require_uppercase      = true
  password_require_lowercase      = true
  password_require_digits         = true
  password_require_special_chars  = true
  password_history_count          = 5
  password_max_age_days           = 90
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName)
}

func testAccRealmConfigWithBruteForceProtection(realmName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name                = "%s"
  display_name        = "Brute Force Protection Test"
  enabled             = true
  brute_force_enabled = true
  max_login_failures  = 3
  lockout_duration    = 1800
  failure_reset_time  = 600
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName)
}

func testAccRealmConfigWithMFA(realmName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name                   = "%s"
  display_name           = "MFA Test"
  enabled                = true
  mfa_required           = true
  webauthn_enabled       = true
  webauthn_rp_name       = "Idenplane Test"
  adaptive_auth_enabled  = true
  risk_threshold_step_up = 70
  risk_threshold_block    = 90
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName)
}

func testAccRealmConfigWithRateLimiting(realmName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name                        = "%s"
  display_name                = "Rate Limiting Test"
  enabled                     = true
  rate_limit_enabled         = true
  client_rate_limit_per_minute = 100
  client_rate_limit_per_hour  = 1000
  user_rate_limit_per_minute  = 50
  user_rate_limit_per_hour    = 500
  ip_rate_limit_per_minute    = 30
  ip_rate_limit_per_hour      = 200
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName)
}

func testAccRealmConfigWithEmailVerification(realmName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name                          = "%s"
  display_name                  = "Email Verification Test"
  enabled                       = true
  require_email_verification    = true
  registration_allowed          = true
  registration_approval_required = true
  allowed_email_domains         = ["example.com", "test.com"]
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName)
}

func testAccRealmConfigWithSMTP(realmName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name        = "%s"
  display_name = "SMTP Test"
  enabled     = true
  smtp_host   = "smtp.example.com"
  smtp_port   = 587
  smtp_user   = "noreply@example.com"
  smtp_from   = "noreply@example.com"
  smtp_secure = false
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName)
}

func testAccClientConfig(realmName, clientID string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name = "%s"
}

resource "idenplane_client" "test" {
  realm_id  = idenplane_realm.test.id
  client_id = "%s"
  name      = "Test Client"
  enabled   = true
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName, clientID)
}

func testAccClientConfigWithRedirectURIs(realmName, clientID string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name = "%s"
}

resource "idenplane_client" "test" {
  realm_id     = idenplane_realm.test.id
  client_id    = "%s"
  name         = "Test Client with Redirect"
  enabled      = true
  redirect_uris = [
    "http://localhost:3000/callback",
    "https://app.example.com/callback"
  ]
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName, clientID)
}

func testAccRoleConfig(realmName, roleName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name = "%s"
}

resource "idenplane_role" "test" {
  realm_id = idenplane_realm.test.id
  name     = "%s"
  description = "Test role created by acceptance tests"
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName, roleName)
}

func testAccGroupConfig(realmName, groupName string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name = "%s"
}

resource "idenplane_group" "test" {
  realm_id   = idenplane_realm.test.id
  name       = "%s"
  path       = "/%s"
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName, groupName, groupName)
}

func testAccIdentityProviderConfig(realmName, idpAlias string) string {
	return fmt.Sprintf(`
provider "idenplane" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "idenplane_realm" "test" {
  name = "%s"
}

resource "idenplane_identity_provider" "test" {
  realm_id   = idenplane_realm.test.id
  alias      = "%s"
  provider_id = "oidc"
  enabled     = true
  display_name = "Test OIDC Provider"
}
`, os.Getenv("IDENPLANE_BASE_URL"),
		os.Getenv("IDENPLANE_AUTH_METHOD"),
		os.Getenv("IDENPLANE_ADMIN_USER"),
		os.Getenv("IDENPLANE_ADMIN_PASS"),
		os.Getenv("IDENPLANE_REALM"),
		realmName, idpAlias)
}

// Provider reference for test checks
var testAccProvider *terraform.Provider

func init() {
	testAccProvider = &terraform.Provider{
		ResourcesMap: map[string]*terraform.Resource{
			"idenplane_realm":              nil,
			"idenplane_client":             nil,
			"idenplane_role":               nil,
			"idenplane_group":              nil,
			"idenplane_organization":       nil,
			"idenplane_identity_provider":  nil,
		},
	}
}

// providerConfigure holds the configured Idenplane client (from provider.go)
type providerConfigure struct {
	Client *idenplane.Client
}

// isNotFoundError checks if the error indicates a resource was not found
func isNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return contains(errStr, "not found") ||
		contains(errStr, "404") ||
		contains(errStr, "does not exist")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && findSubstring(s, substr)
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}