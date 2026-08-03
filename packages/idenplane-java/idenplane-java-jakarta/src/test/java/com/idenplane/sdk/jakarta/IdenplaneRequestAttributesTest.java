package com.idenplane.sdk.jakarta;

import com.idenplane.sdk.models.TokenClaims;
import jakarta.servlet.ServletRequest;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class IdenplaneRequestAttributesTest {

    @Test
    void getClaims_returnsClaimsWhenPresent() {
        TokenClaims claims = new TokenClaims();
        claims.setSub("user-123");
        ServletRequest request = mock(ServletRequest.class);
        when(request.getAttribute(IdenplaneRequestAttributes.CLAIMS_ATTRIBUTE)).thenReturn(claims);

        assertThat(IdenplaneRequestAttributes.getClaims(request)).isSameAs(claims);
    }

    @Test
    void getClaims_returnsNullWhenAbsent() {
        ServletRequest request = mock(ServletRequest.class);
        when(request.getAttribute(IdenplaneRequestAttributes.CLAIMS_ATTRIBUTE)).thenReturn(null);

        assertThat(IdenplaneRequestAttributes.getClaims(request)).isNull();
    }

    @Test
    void getClaims_returnsNullWhenAttributeIsWrongType() {
        ServletRequest request = mock(ServletRequest.class);
        when(request.getAttribute(IdenplaneRequestAttributes.CLAIMS_ATTRIBUTE)).thenReturn("not-claims");

        assertThat(IdenplaneRequestAttributes.getClaims(request)).isNull();
    }
}
