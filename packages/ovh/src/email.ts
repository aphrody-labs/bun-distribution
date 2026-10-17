// SPDX-License-Identifier: Apache-2.0
/**
 * OVHcloud Email Management & Deliverability Audit Engine.
 *
 * Covers domain email status, mailbox accounts, email redirections/aliases,
 * and comprehensive deliverability checks (MX, SPF, DKIM selectors, DMARC, Autodiscover).
 */

import { OvhClient } from "./client.js";
import { OvhDns } from "./dns.js";

export interface EmailDomainInfo {
  domain: string;
  status: string;
  allowedAccountSize: number[];
  offer: string;
}

export interface EmailAccount {
  accountName: string;
  description?: string;
  size?: number;
  isBlocked?: boolean;
}

export interface EmailRedirection {
  id: string;
  from: string;
  to: string;
}

export interface EmailDnsAuditScorecard {
  domain: string;
  mxValid: boolean;
  mxRecords: string[];
  spfValid: boolean;
  spfRecord?: string;
  dmarcValid: boolean;
  dmarcRecord?: string;
  dkimValid: boolean;
  dkimSelectors: string[];
  autodiscoverValid: boolean;
  score: "SECURE" | "WARNING" | "CRITICAL";
  recommendations: string[];
}

export class OvhEmail {
  private readonly dns: OvhDns;

  constructor(private readonly client: OvhClient) {
    this.dns = new OvhDns(client);
  }

  /**
   * Get domain email service details and status.
   */
  public async getDomain(domain: string): Promise<EmailDomainInfo> {
    return this.client.get<EmailDomainInfo>(`/email/domain/${domain}`);
  }

  /**
   * List all mailbox accounts for a domain.
   */
  public async listAccounts(domain: string): Promise<EmailAccount[]> {
    const names = await this.client.get<string[]>(`/email/domain/${domain}/account`);
    if (!names || names.length === 0) return [];

    const accounts = await Promise.all(
      names.map(async name => {
        try {
          return await this.client.get<EmailAccount>(`/email/domain/${domain}/account/${name}`);
        } catch {
          return { accountName: name };
        }
      }),
    );

    return accounts;
  }

  /**
   * List email redirections (aliases/forwarders) configured on a domain.
   */
  public async listRedirections(domain: string): Promise<EmailRedirection[]> {
    const ids = await this.client.get<string[]>(`/email/domain/${domain}/redirection`);
    if (!ids || ids.length === 0) return [];

    const redirections = await Promise.all(
      ids.map(async id => {
        return this.client.get<EmailRedirection>(`/email/domain/${domain}/redirection/${id}`);
      }),
    );

    return redirections;
  }

  /**
   * Create an email redirection alias.
   */
  public async createRedirection(
    domain: string,
    from: string,
    to: string,
    localCopy: boolean = false,
    options: { apply?: boolean } = {},
  ): Promise<{ planned: boolean; redirection?: EmailRedirection }> {
    if (!options.apply) {
      return { planned: true };
    }

    const res = await this.client.post<EmailRedirection>(`/email/domain/${domain}/redirection`, {
      from,
      to,
      localCopy,
    });

    return { planned: false, redirection: res };
  }

  /**
   * Delete an email redirection alias.
   */
  public async deleteRedirection(
    domain: string,
    redirectionId: string,
    options: { apply?: boolean } = {},
  ): Promise<{ planned: boolean; deletedId: string }> {
    if (!options.apply) {
      return { planned: true, deletedId: redirectionId };
    }

    await this.client.delete(`/email/domain/${domain}/redirection/${redirectionId}`);
    return { planned: false, deletedId: redirectionId };
  }

  /**
   * Complete deliverability audit across MX, SPF, DKIM selectors, DMARC and Autodiscover.
   */
  public async auditEmailDns(domain: string): Promise<EmailDnsAuditScorecard> {
    const records = await this.dns.listRecords(domain);

    // 1. Audit MX records
    const mxRecords = records
      .filter(r => r.fieldType === "MX" && (r.subDomain === "" || r.subDomain === "@"))
      .map(r => r.target);

    const hasOvhMx = mxRecords.some(t => t.includes("mail.ovh.net"));
    const mxValid = mxRecords.length > 0 && hasOvhMx;

    // 2. Audit SPF record
    const spfRec = records.find(
      r =>
        (r.fieldType === "SPF" || r.fieldType === "TXT") &&
        (r.subDomain === "" || r.subDomain === "@") &&
        r.target.includes("v=spf1"),
    );
    const spfValid = !!spfRec && spfRec.target.includes("mx.ovh.com");

    // 3. Audit DMARC
    const dmarcRec = records.find(
      r => r.fieldType === "TXT" && r.subDomain === "_dmarc" && r.target.includes("v=DMARC1"),
    );
    const dmarcValid = !!dmarcRec;

    // 4. Audit DKIM selectors
    const dkimRecords = records.filter(
      r => r.subDomain.includes("._domainkey") && (r.fieldType === "CNAME" || r.fieldType === "TXT"),
    );
    const dkimSelectors = dkimRecords.map(r => `${r.subDomain} -> ${r.target}`);
    const dkimValid = dkimRecords.length >= 2;

    // 5. Autodiscover
    const autodiscoverRec = records.find(r => r.fieldType === "SRV" && r.subDomain.includes("_autodiscover"));
    const autodiscoverValid = !!autodiscoverRec;

    const recommendations: string[] = [];
    if (!mxValid) {
      recommendations.push("Ensure OVH MX servers (1 mx0.mail.ovh.net, 5 mx1, 50 mx2, 100 mx3) are configured");
    }
    if (!spfValid) {
      recommendations.push("Configure SPF record with 'v=spf1 include:mx.ovh.com ~all'");
    }
    if (!dmarcValid) {
      recommendations.push("Add DMARC policy record on _dmarc TXT: 'v=DMARC1; p=none; adkim=s; aspf=s'");
    }
    if (!dkimValid) {
      recommendations.push("Ensure both ovhmo-selector-1 and ovhmo-selector-2 CNAME records are published for DKIM");
    }

    let score: EmailDnsAuditScorecard["score"] = "SECURE";
    if (!mxValid || !spfValid) {
      score = "CRITICAL";
    } else if (!dmarcValid || !dkimValid) {
      score = "WARNING";
    }

    return {
      domain,
      mxValid,
      mxRecords,
      spfValid,
      spfRecord: spfRec?.target,
      dmarcValid,
      dmarcRecord: dmarcRec?.target,
      dkimValid,
      dkimSelectors,
      autodiscoverValid,
      score,
      recommendations,
    };
  }
}
