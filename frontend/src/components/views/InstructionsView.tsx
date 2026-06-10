import { type ReactNode } from 'react'

export function InstructionsView() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-2">Instructions</h1>
      <p className="text-sm text-slate-600 mb-6">
        How to connect your source systems to this app for profiling, conversion, and
        reconciliation — including the network paths each utility uses.
      </p>

      <Section title="How the app connects to your sources" defaultOpen>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <b>Profiler</b> connects <i>from the app container</i> (Databricks Apps serverless
            infrastructure) directly to your database over TCP 1433 using the bundled Microsoft
            ODBC Driver 18. Your database firewall must allow the Databricks{' '}
            <b>serverless egress IP ranges</b> of this workspace&apos;s region.
          </li>
          <li>
            <b>Reconciliation</b> and the <b>LLM converter (Switch)</b> run as{' '}
            <i>serverless jobs in the workspace</i>. Reconciliation reads non-Databricks sources
            through a Unity Catalog (Lakehouse Federation) <b>connection</b>, so the same
            serverless egress ranges apply.
          </li>
          <li>
            <b>Analyzer</b> and the <b>standard converter</b> process uploaded files inside the
            container — no source connectivity required.
          </li>
        </ul>
      </Section>

      <Section title="Step 1 — Find the IPs to allow">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Azure Databricks publishes <b>stable egress public IPs for serverless compute</b> per
            region (see &quot;Azure Databricks serverless compute plane networking&quot; in the
            docs, or your account console → Cloud resources → Network Connectivity
            Configurations).
          </li>
          <li>
            Add those ranges to your database firewall (Azure SQL: server-level firewall rules;
            on-prem: your perimeter firewall). Avoid 0.0.0.0/0 — most org policies deny it.
          </li>
          <li>
            For stricter setups, create a <b>Network Connectivity Configuration (NCC)</b> in the
            account console, attach it to this workspace, and either use its stable egress IPs or
            <b> private endpoints</b> to your data source.
          </li>
        </ol>
      </Section>

      <Section title="Azure SQL Database / SQL Server (cloud)">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Ensure <b>SQL authentication</b> is enabled (Microsoft Entra-only authentication off),
            or use an AD password login via the Synapse auth options.
          </li>
          <li>
            Create a least-privilege login for profiling: <Code>db_datareader</Code> plus{' '}
            <Code>VIEW DATABASE STATE</Code> (activity metrics).
          </li>
          <li>Allow the serverless egress ranges in the server firewall (Step 1).</li>
          <li>
            In <b>Profiler → SQL Server</b>: enter the fully-qualified server name
            (<Code>myserver.database.windows.net</Code>), port 1433, <b>database name</b>, user,
            and password, then <b>Save &amp; Test Connection</b>.
          </li>
        </ol>
      </Section>

      <Section title="Azure Synapse">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            In <b>Profiler → Azure Synapse</b>: enter the workspace name (endpoints are derived as{' '}
            <Code>&lt;name&gt;.sql.azuresynapse.net</Code> and{' '}
            <Code>&lt;name&gt;-ondemand.sql.azuresynapse.net</Code>), the development endpoint,
            and SQL credentials.
          </li>
          <li>
            Choose the JDBC auth type: <Code>sql_authentication</Code>,{' '}
            <Code>ad_passwd_authentication</Code>, or <Code>spn_authentication</Code>. If the
            workspace enforces Entra-only authentication, SQL auth logins will be rejected.
          </li>
          <li>
            Allow the serverless egress ranges on the Synapse workspace firewall (both dedicated
            and serverless SQL endpoints).
          </li>
        </ol>
      </Section>

      <Section title="On-premises sources (ExpressRoute / Direct Connect / VPN)">
        <p className="mb-2">
          Serverless compute (the app container and serverless jobs) does not run inside your
          VNet, so reaching on-prem requires one of these patterns:
        </p>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <b>Private connectivity (recommended):</b> create an NCC with a{' '}
            <b>private endpoint</b> to a Private Link service that fronts your database (e.g. a
            standard load balancer in your VNet forwarding to on-prem over{' '}
            <b>ExpressRoute private peering</b> or site-to-site VPN). On AWS, the analog is
            PrivateLink over <b>Direct Connect</b>.
          </li>
          <li>
            <b>Public path with allowlisting:</b> expose the database through a controlled public
            endpoint (NAT/firewall) and allow only the Databricks serverless egress ranges.
          </li>
          <li>
            <b>DNS:</b> the hostname you enter must resolve from the Databricks side. With private
            endpoints, use the private DNS zone name; otherwise use a public DNS name.
          </li>
          <li>
            <b>On-prem firewall and routing:</b> permit inbound TCP 1433 from the chosen path and
            ensure return routes exist (advertised over BGP for ExpressRoute/Direct Connect).
          </li>
        </ol>
      </Section>

      <Section title="Reconciliation setup">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Create a Unity Catalog connection to the source (workspace admin, SQL editor):
            <Pre>{`CREATE CONNECTION my_mssql TYPE SQLSERVER
OPTIONS (host '<server>', port '1433', user '<user>', password '<password>');
GRANT USE CONNECTION ON CONNECTION my_mssql TO \`<app service principal id>\`;`}</Pre>
          </li>
          <li>
            In <b>Reconcile → Configure &amp; deploy</b>: pick the data source, enter the
            connection name, source database/schema, and the Databricks target catalog/schema,
            then deploy (creates the Reconciliation job, metadata tables in{' '}
            <Code>lakebridge.reconciler</Code>, and dashboards).
          </li>
          <li>Define table mappings (join columns for row/data reports) and run.</li>
          <li>
            The job runs on <b>serverless compute</b>; its source reads go through the UC
            connection, so the same firewall/network path as above must be in place.
          </li>
        </ol>
      </Section>

      <Section title="Permissions & credentials checklist">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Unity Catalog: the Converter&apos;s LLM panel shows live status for the standard
            layout (catalog <Code>lakebridge</Code>, schemas{' '}
            <Code>analyzer / profiler / converter / reconciler</Code>) with exact GRANT statements
            when something is missing. Granting the app service principal{' '}
            <Code>USE CATALOG</Code> + <Code>CREATE SCHEMA</Code> on <Code>lakebridge</Code> lets
            the app provision everything else itself.
          </li>
          <li>
            For non-Databricks reconciliation sources: <Code>USE CONNECTION</Code> on the UC
            connection.
          </li>
          <li>
            Profiler credentials are stored only inside the app container (
            <Code>~/.databricks/labs/lakebridge/.credentials.yml</Code>) and are re-entered after
            a redeploy. Keep the master copy in a secret store such as Azure Key Vault.
          </li>
          <li>
            Use least-privilege, dedicated database logins for profiling and reconciliation —
            avoid server admin accounts outside of labs.
          </li>
        </ul>
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="group border border-slate-200 rounded-lg mb-3 open:shadow-sm"
    >
      <summary className="cursor-pointer select-none px-5 py-3.5 text-base font-semibold text-slate-900 flex items-center justify-between hover:bg-slate-50 rounded-lg">
        {title}
        <svg
          className="transition-transform group-open:rotate-180"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6c8497"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="px-5 pb-5 pt-1 text-sm text-slate-700 leading-relaxed">{children}</div>
    </details>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{children}</code>
}

function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="bg-slate-900 text-slate-100 text-xs rounded-md p-3 overflow-x-auto my-2">
      {children}
    </pre>
  )
}
