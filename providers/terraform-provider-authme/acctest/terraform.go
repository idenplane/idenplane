package acctest

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/authme/terraform-provider-authme/authme"
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
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttrSet("authme_realm.test", "id"),
					resource.TestCheckResourceAttr("authme_realm.test", "name", RealmName),
					resource.TestCheckResourceAttr("authme_realm.test", "display_name", displayName),
					resource.TestCheckResourceAttr("authme_realm.test", "enabled", "true"),
				),
			},
			{
				Config: testAccRealmConfigUpdated(RealmName, updatedDisplayName),
				Check: resource.ComposeTestCheckFunc(
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttr("authme_realm.test", "name", RealmName),
					resource.TestCheckResourceAttr("authme_realm.test", "display_name", updatedDisplayName),
				),
			},
			{
				ResourceName:      "authme_realm.test",
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
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttr("authme_realm.test", "password_min_length", "12"),
					resource.TestCheckResourceAttr("authme_realm.test", "password_require_uppercase", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "password_require_lowercase", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "password_require_digits", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "password_require_special_chars", "true"),
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
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttr("authme_realm.test", "brute_force_enabled", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "max_login_failures", "3"),
					resource.TestCheckResourceAttr("authme_realm.test", "lockout_duration", "1800"),
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
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttr("authme_realm.test", "mfa_required", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "webauthn_enabled", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "adaptive_auth_enabled", "true"),
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
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttr("authme_realm.test", "rate_limit_enabled", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "client_rate_limit_per_minute", "100"),
					resource.TestCheckResourceAttr("authme_realm.test", "ip_rate_limit_per_minute", "30"),
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
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttr("authme_realm.test", "require_email_verification", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "registration_approval_required", "true"),
					resource.TestCheckResourceAttr("authme_realm.test", "allowed_email_domains.#", "2"),
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
					testAccCheckRealmExists("authme_realm.test"),
					resource.TestCheckResourceAttr("authme_realm.test", "smtp_host", "smtp.example.com"),
					resource.TestCheckResourceAttr("authme_realm.test", "smtp_port", "587"),
					resource.TestCheckResourceAttr("authme_realm.test", "smtp_from", "noreply@example.com"),
					resource.TestCheckResourceAttr("authme_realm.test", "smtp_secure", "false"),
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
					testAccCheckRealmExists("authme_realm.test"),
					testAccCheckClientExists("authme_client.test"),
					resource.TestCheckResourceAttrSet("authme_client.test", "id"),
					resource.TestCheckResourceAttr("authme_client.test", "client_id", clientID),
					resource.TestCheckResourceAttr("authme_client.test", "enabled", "true"),
				),
			},
			{
				ResourceName:      "authme_client.test",
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
					testAccCheckClientExists("authme_client.test"),
					resource.TestCheckResourceAttr("authme_client.test", "redirect_uris.#", "2"),
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
					testAccCheckRealmExists("authme_realm.test"),
					testAccCheckRoleExists("authme_role.test"),
					resource.TestCheckResourceAttrSet("authme_role.test", "id"),
					resource.TestCheckResourceAttr("authme_role.test", "name", roleName),
				),
			},
			{
				ResourceName:      "authme_role.test",
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
					testAccCheckRealmExists("authme_realm.test"),
					testAccCheckGroupExists("authme_group.test"),
					resource.TestCheckResourceAttrSet("authme_group.test", "id"),
					resource.TestCheckResourceAttr("authme_group.test", "name", groupName),
				),
			},
			{
				ResourceName:      "authme_group.test",
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
					testAccCheckRealmExists("authme_realm.test"),
					testAccCheckIdentityProviderExists("authme_identity_provider.test"),
					resource.TestCheckResourceAttrSet("authme_identity_provider.test", "id"),
					resource.TestCheckResourceAttr("authme_identity_provider.test", "alias", idpAlias),
				),
			},
			{
				ResourceName:      "authme_identity_provider.test",
				ImportState:       true,
				ImportStateVerify: true,
			},
		},
	})
}

// Helper functions

func testAccPreCheck(t *testing.T) {
	if v := os.Getenv("AUTHME_BASE_URL"); v == "" {
		t.Skip("AUTHME_BASE_URL is not set; acceptance tests skipped")
	}
}

func testProviderFactories() map[string]func() (*terraform.ResourceProvider, error) {
	return map[string]func() (*terraform.ResourceProvider, error){
		"authme": func() (*terraform.ResourceProvider, error) {
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
		if rs.Type != "authme_realm" {
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
		if rs.Type != "authme_client" {
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
		if rs.Type != "authme_role" {
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
		if rs.Type != "authme_group" {
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
		if rs.Type != "authme_identity_provider" {
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
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name         = "%s"
  display_name = "%s"
  enabled      = true
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName, displayName)
}

func testAccRealmConfigUpdated(realmName, displayName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name         = "%s"
  display_name = "%s"
  enabled      = true
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName, displayName)
}

func testAccRealmConfigWithPasswordPolicy(realmName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
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
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName)
}

func testAccRealmConfigWithBruteForceProtection(realmName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name                = "%s"
  display_name        = "Brute Force Protection Test"
  enabled             = true
  brute_force_enabled = true
  max_login_failures  = 3
  lockout_duration    = 1800
  failure_reset_time  = 600
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName)
}

func testAccRealmConfigWithMFA(realmName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name                   = "%s"
  display_name           = "MFA Test"
  enabled                = true
  mfa_required           = true
  webauthn_enabled       = true
  webauthn_rp_name       = "AuthMe Test"
  adaptive_auth_enabled  = true
  risk_threshold_step_up = 70
  risk_threshold_block    = 90
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName)
}

func testAccRealmConfigWithRateLimiting(realmName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
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
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName)
}

func testAccRealmConfigWithEmailVerification(realmName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name                          = "%s"
  display_name                  = "Email Verification Test"
  enabled                       = true
  require_email_verification    = true
  registration_allowed          = true
  registration_approval_required = true
  allowed_email_domains         = ["example.com", "test.com"]
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName)
}

func testAccRealmConfigWithSMTP(realmName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name        = "%s"
  display_name = "SMTP Test"
  enabled     = true
  smtp_host   = "smtp.example.com"
  smtp_port   = 587
  smtp_user   = "noreply@example.com"
  smtp_from   = "noreply@example.com"
  smtp_secure = false
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName)
}

func testAccClientConfig(realmName, clientID string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name = "%s"
}

resource "authme_client" "test" {
  realm_id  = authme_realm.test.id
  client_id = "%s"
  name      = "Test Client"
  enabled   = true
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName, clientID)
}

func testAccClientConfigWithRedirectURIs(realmName, clientID string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name = "%s"
}

resource "authme_client" "test" {
  realm_id     = authme_realm.test.id
  client_id    = "%s"
  name         = "Test Client with Redirect"
  enabled      = true
  redirect_uris = [
    "http://localhost:3000/callback",
    "https://app.example.com/callback"
  ]
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName, clientID)
}

func testAccRoleConfig(realmName, roleName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name = "%s"
}

resource "authme_role" "test" {
  realm_id = authme_realm.test.id
  name     = "%s"
  description = "Test role created by acceptance tests"
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName, roleName)
}

func testAccGroupConfig(realmName, groupName string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name = "%s"
}

resource "authme_group" "test" {
  realm_id   = authme_realm.test.id
  name       = "%s"
  path       = "/%s"
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName, groupName, groupName)
}

func testAccIdentityProviderConfig(realmName, idpAlias string) string {
	return fmt.Sprintf(`
provider "authme" {
  base_url   = "%s"
  auth_method = "%s"
  admin_user  = "%s"
  admin_pass  = "%s"
  realm       = "%s"
}

resource "authme_realm" "test" {
  name = "%s"
}

resource "authme_identity_provider" "test" {
  realm_id   = authme_realm.test.id
  alias      = "%s"
  provider_id = "oidc"
  enabled     = true
  display_name = "Test OIDC Provider"
}
`, os.Getenv("AUTHME_BASE_URL"),
		os.Getenv("AUTHME_AUTH_METHOD"),
		os.Getenv("AUTHME_ADMIN_USER"),
		os.Getenv("AUTHME_ADMIN_PASS"),
		os.Getenv("AUTHME_REALM"),
		realmName, idpAlias)
}

// Provider reference for test checks
var testAccProvider *terraform.Provider

func init() {
	testAccProvider = &terraform.Provider{
		ResourcesMap: map[string]*terraform.Resource{
			"authme_realm":              nil,
			"authme_client":             nil,
			"authme_role":               nil,
			"authme_group":              nil,
			"authme_organization":       nil,
			"authme_identity_provider":  nil,
		},
	}
}

// providerConfigure holds the configured AuthMe client (from provider.go)
type providerConfigure struct {
	Client *authme.Client
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