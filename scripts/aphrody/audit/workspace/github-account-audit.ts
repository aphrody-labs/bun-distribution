/* SPDX-License-Identifier: Apache-2.0 */
/** Full, redacted GitHub account audit for the aphrody-code namespace. */
type Repo = {
  full_name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  visibility: string;
  size: number;
  stargazers_count: number;
  forks_count: number;
  description: string | null;
  html_url: string;
};
const api = async (path: string): Promise<unknown> =>
  JSON.parse((await Bun.$`gh api ${path}`.quiet()).stdout.toString());
const repos = (await api(
  "user/repos?per_page=100&affiliation=owner",
)) as Repo[];
const packages: unknown[] = [];
for (const type of [
  "npm",
  "container",
  "maven",
  "rubygems",
  "nuget",
  "docker",
]) {
  try {
    packages.push(
      ...((await api(
        `user/packages?package_type=${type}&per_page=100`,
      )) as unknown[]),
    );
  } catch {
    /* unsupported package type */
  }
}
const collaborator = await Promise.all(
  repos.map(async (repo) => {
    try {
      const result = (await api(
        `repos/${repo.full_name}/collaborators/aphrody-dev/permission`,
      )) as { user?: { permissions?: { admin?: boolean } } };
      return {
        repository: repo.full_name,
        admin: result.user?.permissions?.admin === true,
      };
    } catch {
      return { repository: repo.full_name, admin: false };
    }
  }),
);
const report = {
  generatedBy: "aphrody git",
  generatedAt: new Date().toISOString(),
  owner: "aphrody-code",
  policy: {
    allRepositoriesPrivate: repos.every((repo) => repo.private),
    allPackagesPrivate: (packages as Array<{ visibility?: string }>).every(
      (pkg) => pkg.visibility === "private",
    ),
  },
  repositories: {
    total: repos.length,
    active: repos.filter((repo) => !repo.archived).length,
    archived: repos.filter((repo) => repo.archived).length,
    public: repos.filter((repo) => !repo.private).map((repo) => repo.full_name),
  },
  collaborator: {
    login: "aphrody-dev",
    adminCount: collaborator.filter((item) => item.admin).length,
    missingOrUnavailable: collaborator
      .filter((item) => !item.admin)
      .map((item) => item.repository),
  },
  packages: {
    total: packages.length,
    private: (packages as Array<{ visibility?: string }>).filter(
      (pkg) => pkg.visibility === "private",
    ).length,
    names: (packages as Array<{ name?: string; package_type?: string }>).map(
      (pkg) => `${pkg.package_type}:${pkg.name}`,
    ),
  },
  gists: (
    (await api("gists?per_page=100")) as Array<{
      id: string;
      public: boolean;
      html_url: string;
    }>
  ).map((gist) => ({ id: gist.id, public: gist.public, url: gist.html_url })),
};
await Bun.write(
  ".agents/plugins/github-account-audit.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  `audited ${repos.length} repositories, ${packages.length} packages, ${report.gists.length} gists`,
);
