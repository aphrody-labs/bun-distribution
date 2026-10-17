// SPDX-License-Identifier: Apache-2.0
//! The crawlability fixture pages: representative server-rendered usage of the m3 packages
//! (primitives, forms, explorer, readers) inside an App Router style document shell. Loaded only
//! through `web-crawlability-fixture.ts`, which pins `react` to the UI packages' copy first.
//!
//! Page-level markup (landmarks, one h1, labelled controls) is written correctly on purpose: the
//! audit measures what the *components* contribute, so a regression in a package shows up as a gap.

import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { useForm } from "react-hook-form";

import {
  Accordion,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckBox,
  CircleButton,
  CircularProgress,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Divider,
  Icon,
  InfoBanner,
  InfoBannerSubtext,
  InfoBannerText,
  Input,
  Label,
  Loader,
  Meter,
  OptionList,
  OptionListItem,
  PasswordInput,
  ProgressBar,
  RadioGroupItem,
  RadioGroupRoot,
  RadixCheckbox,
  SearchBar,
  Select,
  SelectOption,
  Shortcut,
  Slider,
  Switch,
  TabBar,
  TabBarItem,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
  TextArea,
  ToggleGroup,
} from "@aphrody/m3-primitives";
import {
  CheckboxField,
  Form,
  InputField,
  RadioGroupField,
  SelectField,
  SwitchField,
  TextAreaField,
} from "@aphrody/m3-forms";
import { FileThumb, GridItem, RenameInput, TagPill } from "@aphrody/m3-explorer";
import { CaptionedReader, CollectionReader, MangaReader } from "@aphrody/m3-reader";
import { M3Document, m3SchemeCss } from "@aphrody/m3-next/server";
import { m3JsonLd } from "@aphrody/m3-next";
import type { PageKind, SitePage } from "../../../../../scripts/aphrody-source/audit/web-crawlability.ts";

interface PageSpec {
  path: string;
  kind: PageKind;
  title: string;
  description: string;
  heading: string;
  jsonLd: (origin: string) => unknown[];
  body: () => ReactNode; // a component: hooks inside are allowed
}

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/primitives", label: "Primitives" },
  { href: "/forms", label: "Forms" },
  { href: "/explorer", label: "Explorer" },
  { href: "/reader/manga", label: "Manga reader" },
  { href: "/reader/databook", label: "Databook reader" },
  { href: "/reader/collection", label: "Collection reader" },
  { href: "/data", label: "Data" },
];

function Shell({
  spec,
  origin,
  schemeCss,
  children,
}: {
  spec: PageSpec;
  origin: string;
  schemeCss: string;
  children: ReactNode;
}) {
  return (
    <M3Document
      mode="system"
      lang="en"
      schemeCss={schemeCss}
      head={
        <>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{spec.title}</title>
          <meta name="description" content={spec.description} />
          <link rel="canonical" href={`${origin}${spec.path}`} />
          {spec.jsonLd(origin).map((data, index) => (
            <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: m3JsonLd(data) }} />
          ))}
        </>
      }
    >
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <header className="flex items-center gap-4 p-4" data-testid="site-header">
        <p className="text-title-large">Aphrody UI</p>
        <nav aria-label="Primary">
          <ul className="flex flex-wrap gap-2">
            {NAV.map(item => (
              <li key={item.href}>
                <Button href={item.href} variant="text" aria-current={item.href === spec.path ? "page" : undefined}>
                  {item.label}
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl p-4">
        <h1 className="text-display-small">{spec.heading}</h1>
        {children}
      </main>
      <footer className="p-4" data-testid="site-footer">
        <nav aria-label="Footer">
          <a href="/llms.txt">llms.txt</a> · <a href="/sitemap.xml">Sitemap</a> · <a href="/robots.txt">robots.txt</a>
        </nav>
        <p className="text-body-small">
          Material Design 3 components for React, rendered on the server and readable without JavaScript.
        </p>
      </footer>
    </M3Document>
  );
}

const section = (title: string, children: ReactNode, id: string) => (
  <section aria-labelledby={`${id}-h`} className="my-8">
    <h2 id={`${id}-h`} className="text-headline-small">
      {title}
    </h2>
    {children}
  </section>
);

const noop = () => {};

function Landing() {
  const cards = NAV.slice(1);
  return (
    <>
      <p className="text-body-large">
        This site is a crawl fixture for the Aphrody Material Design 3 packages. Each page below renders real components
        on the server, so a crawler that never runs JavaScript sees the same headings, links, form labels and landmarks
        that a reader does.
      </p>
      {section(
        "Explore the component packages",
        <ul className="grid gap-4 expanded:grid-cols-2">
          {cards.map(item => (
            <li key={item.href}>
              <Card>
                <CardHeader>
                  <CardTitle>{item.label}</CardTitle>
                  <CardDescription>
                    Open the {item.label.toLowerCase()} page to see the server-rendered markup.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button href={item.href} variant="tonal" aria-label={`Open ${item.label}`}>
                    Open
                  </Button>
                  <Badge variant="secondary">SSR</Badge>
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>,
        "explore",
      )}
      {section(
        "What the audit checks",
        <ul className="list-disc ps-6 text-body-medium">
          <li>One h1 per page, no skipped heading levels and named landmarks.</li>
          <li>Every image has an alternative and every control has an accessible name.</li>
          <li>Navigation is made of real links that a crawler can follow.</li>
          <li>Components carry stable data attributes for end-to-end tests and agents.</li>
        </ul>,
        "checks",
      )}
    </>
  );
}

function Primitives() {
  return (
    <>
      <p className="text-body-large">
        Buttons, inputs, selection controls, tabs, feedback and display components from the primitives package, each
        with the name a screen reader or an agent would use.
      </p>
      {section(
        "Buttons and badges",
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="filled">Save changes</Button>
          <Button variant="outlined">Cancel</Button>
          <Button variant="tonal" href="/forms">
            Go to forms
          </Button>
          <Button variant="text" loading>
            Loading action
          </Button>
          <CircleButton icon="more_horiz" aria-label="More actions" />
          <CircleButton icon="favorite" active aria-label="Favorite" />
          <Badge>New</Badge>
          <Badge variant="error">3 errors</Badge>
          <Shortcut chars="Ctrl K" />
        </div>,
        "buttons",
      )}
      {section(
        "Text fields",
        <div className="flex flex-col gap-4">
          <div>
            <Label slug="field-email">Email address</Label>
            <Input
              id="field-email"
              type="email"
              placeholder="you@example.com"
              supportingText="We never share your address."
            />
          </div>
          <div>
            <Label slug="field-password">Password</Label>
            <PasswordInput id="field-password" placeholder="At least 12 characters" />
          </div>
          <div>
            <Label slug="field-notes">Notes</Label>
            <TextArea id="field-notes" placeholder="Anything else we should know?" />
          </div>
          <SearchBar aria-label="Search the documentation" placeholder="Search the documentation" />
        </div>,
        "fields",
      )}
      {section(
        "Selection controls",
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <CheckBox id="opt-news" />
            <label htmlFor="opt-news">Send me product news</label>
          </div>
          <RadixCheckbox name="opt-terms" label="I accept the terms of service" />
          <div className="flex items-center gap-2">
            <Switch aria-label="Enable notifications" />
            <span>Notifications</span>
          </div>
          <Slider aria-label="Volume" defaultValue={[40]} getAriaLabel={() => "Volume"} />
          <RadioGroupRoot defaultValue="monthly" aria-label="Billing period">
            <RadioGroupItem value="monthly">Billed monthly</RadioGroupItem>
            <RadioGroupItem value="yearly">Billed yearly</RadioGroupItem>
          </RadioGroupRoot>
          <ToggleGroup
            value="grid"
            onChange={noop}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
          />
          <Select value="gold" onChange={noop} placeholder="Choose a plan" name="plan">
            <SelectOption value="free">Free</SelectOption>
            <SelectOption value="gold">Gold</SelectOption>
          </Select>
          <OptionList>
            <OptionListItem selected>Overview</OptionListItem>
            <OptionListItem>Activity</OptionListItem>
          </OptionList>
        </div>,
        "selection",
      )}
      {section(
        "Navigation",
        <div className="flex flex-col gap-4">
          <TabsRoot defaultValue="overview">
            <TabsList aria-label="Account sections">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p>Overview of the account: plan, usage and recent activity.</p>
            </TabsContent>
            <TabsContent value="billing">
              <p>Billing details and invoices.</p>
            </TabsContent>
          </TabsRoot>
          <TabBar>
            <TabBarItem active label="Inbox" />
            <TabBarItem label="Archive" />
          </TabBar>
        </div>,
        "navigation",
      )}
      {section(
        "Disclosure",
        <div className="flex flex-col gap-4">
          <Accordion.Root defaultValue={["shipping"]}>
            <Accordion.Item value="shipping">
              <Accordion.Header>
                <Accordion.Trigger>Shipping and delivery</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel>Orders ship within two business days and arrive in three to five.</Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="returns">
              <Accordion.Header>
                <Accordion.Trigger>Returns</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel>Unused items can be returned within thirty days.</Accordion.Panel>
            </Accordion.Item>
          </Accordion.Root>
          <Collapsible defaultOpen>
            <CollapsibleTrigger>More about the plan</CollapsibleTrigger>
            <CollapsibleContent>The gold plan includes priority support and unlimited projects.</CollapsibleContent>
          </Collapsible>
        </div>,
        "disclosure",
      )}
      {section(
        "Feedback and status",
        <div className="flex flex-col gap-4">
          <Banner variant="info">Your changes were saved.</Banner>
          <InfoBanner icon="info">
            <InfoBannerText>Scheduled maintenance</InfoBannerText>
            <InfoBannerSubtext>The service will be read-only on Sunday between 02:00 and 03:00 UTC.</InfoBannerSubtext>
          </InfoBanner>
          <ProgressBar value={40} total={100} />
          <Meter label="Storage used" value={62} />
          <CircularProgress radius={24} progress={65} />
          <Loader />
        </div>,
        "feedback",
      )}
      {section(
        "Display",
        <div className="flex flex-wrap items-center gap-4">
          <Avatar alt="Ada Lovelace" fallback="AL" />
          <Avatar src="/assets/avatar-grace.png" alt="Grace Hopper" />
          <Icon name="check_circle" label="Verified" />
          <Divider />
        </div>,
        "display",
      )}
    </>
  );
}

function FormsPage() {
  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      message: "",
      role: "user",
      plan: "free",
      agree: false,
      notify: true,
    },
  });
  return (
    <>
      <p className="text-body-large">
        A contact form built from the react-hook-form fields of the forms package. Every field has a visible label tied
        to its control and supporting text where it helps.
      </p>
      <Form {...form}>
        <form action="/forms/submit" method="post" aria-label="Contact form" className="flex flex-col gap-4">
          <InputField name="name" label="Full name" description="As it appears on your invoices." required />
          <InputField name="email" label="Email address" type="email" placeholder="you@example.com" />
          <TextAreaField name="message" label="How can we help?" description="Tell us a little about your project." />
          <SelectField
            name="role"
            label="Your role"
            placeholder="Select a role"
            options={[
              { value: "admin", label: "Administrator" },
              { value: "user", label: "User" },
            ]}
          />
          <RadioGroupField
            name="plan"
            label="Plan"
            options={[
              { value: "free", label: "Free" },
              { value: "gold", label: "Gold" },
            ]}
          />
          <CheckboxField name="agree" label="I agree to be contacted" description="You can unsubscribe at any time." />
          <SwitchField name="notify" label="Email notifications" description="Receive a weekly summary." />
          <div className="flex gap-2">
            <Button type="submit" variant="filled">
              Send message
            </Button>
            <Button type="reset" variant="outlined">
              Reset
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}

function Explorer() {
  const thumb = { iconSrc: "/assets/document.svg" };
  return (
    <>
      <p className="text-body-large">
        File management tiles from the explorer package: selectable grid items, tag chips and an inline rename field.
      </p>
      {section(
        "Files",
        <ul className="grid grid-cols-3 gap-2">
          {["Quarterly report", "Design brief", "Meeting notes"].map((name, index) => (
            <li key={name}>
              <GridItem
                name={name}
                extension={index === 0 ? "pdf" : "md"}
                sizeText={`${index + 1}.${index} MB`}
                selected={index === 0}
                thumb={thumb}
                tags={[{ color: "#ef4444", name: "Important" }]}
              />
            </li>
          ))}
        </ul>,
        "files",
      )}
      {section(
        "Tags",
        <div className="flex flex-wrap gap-2">
          <TagPill color="#22c55e" onClick={noop}>
            Done
          </TagPill>
          <TagPill color="#3b82f6" selected onClick={noop} onRemove={noop}>
            Work
          </TagPill>
        </div>,
        "tags",
      )}
      {section(
        "Rename",
        <div className="flex items-center gap-3">
          <FileThumb iconSrc="/assets/folder.svg" size={48} />
          <RenameInput name="Projects" onSave={async () => {}} onCancel={noop} />
        </div>,
        "rename",
      )}
    </>
  );
}

const MANGA_PAGES = ["/assets/manga/p1.jpg", "/assets/manga/p2.jpg", "/assets/manga/p3.jpg"];

function MangaPage() {
  return (
    <>
      <p className="text-body-large">
        A paged manga reader. Chapter navigation uses real links, and each page image carries an alternative text.
      </p>
      <MangaReader
        title="Chapter 1: The beginning"
        pages={MANGA_PAGES}
        prevHref="/reader/collection"
        nextHref="/reader/databook"
        apiPageHref={page => `/api/pages/${page}`}
      />
    </>
  );
}

function DatabookPage() {
  return (
    <>
      <p className="text-body-large">
        An illustrated databook with transcriptions, so the text of every plate is available without the image.
      </p>
      <CaptionedReader
        title="Illustrated guide"
        pages={[
          {
            number: 1,
            image: "/assets/databook/a.jpg",
            text: "A hand-drawn map of the island with the three villages marked.",
          },
          {
            number: 2,
            image: "/assets/databook/b.jpg",
            text: "Portrait of the captain, with notes on her favourite techniques.",
          },
        ]}
      />
    </>
  );
}

function CollectionPage() {
  return (
    <>
      <p className="text-body-large">Edition and chapter navigation shared by volumes and illustrated collections.</p>
      <CollectionReader
        title="The complete collection"
        editions={[
          {
            id: "vol-1",
            label: "Volume 1",
            chapters: [
              { id: 1, label: "Chapter 1", pageCount: 12 },
              { id: 2, label: "Chapter 2", pageCount: 8 },
            ],
          },
        ]}
        emptyLabel="Nothing to read yet"
        contentsLabel="Contents"
        previousLabel="Previous"
        nextLabel="Next"
        renderChapter={(_edition, chapter) => (
          <article>
            <h2>{chapter.label}</h2>
            <p>The opening pages of {chapter.label} introduce the characters and set the scene.</p>
          </article>
        )}
      />
    </>
  );
}

function DataPage() {
  const rows = [
    ["Aphrody", "m3-primitives", "Buttons, inputs, overlays", "stable"],
    ["Aphrody", "m3-forms", "react-hook-form fields", "stable"],
    ["Aphrody", "m3-explorer", "File management tiles", "beta"],
    ["Aphrody", "m3-reader", "Manga and databook readers", "beta"],
  ];
  return (
    <>
      <p className="text-body-large">
        A data table and a description list, the plain HTML structures crawlers extract most reliably.
      </p>
      {section(
        "Packages",
        <table>
          <caption>Component packages and their status</caption>
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Package</th>
              <th scope="col">Contents</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row[1]}>
                <th scope="row">{row[0]}</th>
                <td>{row[1]}</td>
                <td>{row[2]}</td>
                <td>
                  <Badge variant={row[3] === "stable" ? "success" : "warning"}>{row[3]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>,
        "packages",
      )}
      {section(
        "Glossary",
        <dl>
          <dt>SSR</dt>
          <dd>Server-side rendering: the HTML is produced before it reaches the browser.</dd>
          <dt>Landmark</dt>
          <dd>A region of the page, such as main or navigation, announced by assistive technology.</dd>
        </dl>,
        "glossary",
      )}
    </>
  );
}

const website = (origin: string) => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Aphrody UI crawl fixture",
  url: `${origin}/`,
});
const webPage = (origin: string, path: string, name: string, description: string) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name,
  description,
  url: `${origin}${path}`,
});

const SPECS: PageSpec[] = [
  {
    path: "/",
    kind: "landing",
    title: "Aphrody UI crawl fixture",
    description:
      "Server-rendered Material Design 3 components that crawlers and LLM agents can read without JavaScript.",
    heading: "Aphrody UI crawl fixture",
    jsonLd: origin => [website(origin)],
    body: Landing,
  },
  {
    path: "/primitives",
    kind: "primitives",
    title: "Primitives - Aphrody UI",
    description:
      "Buttons, text fields, selection controls, tabs, feedback and display components rendered on the server.",
    heading: "Primitives",
    jsonLd: origin => [webPage(origin, "/primitives", "Primitives", "Server-rendered primitives")],
    body: Primitives,
  },
  {
    path: "/forms",
    kind: "forms",
    title: "Forms - Aphrody UI",
    description: "A contact form built from the react-hook-form fields of the forms package.",
    heading: "Contact us",
    jsonLd: origin => [{ ...webPage(origin, "/forms", "Contact us", "Contact form"), "@type": "ContactPage" }],
    body: FormsPage,
  },
  {
    path: "/explorer",
    kind: "explorer",
    title: "Explorer - Aphrody UI",
    description: "File tiles, tag chips and an inline rename field from the explorer package.",
    heading: "File explorer",
    jsonLd: origin => [webPage(origin, "/explorer", "File explorer", "Explorer components")],
    body: Explorer,
  },
  {
    path: "/reader/manga",
    kind: "reader",
    title: "Manga reader - Aphrody UI",
    description: "A paged manga reader with real chapter links and image alternatives.",
    heading: "Manga reader",
    jsonLd: origin => [
      {
        "@context": "https://schema.org",
        "@type": "Chapter",
        name: "Chapter 1: The beginning",
        isPartOf: { "@type": "ComicSeries", name: "Aphrody Chronicles" },
        url: `${origin}/reader/manga`,
      },
    ],
    body: MangaPage,
  },
  {
    path: "/reader/databook",
    kind: "reader",
    title: "Databook reader - Aphrody UI",
    description: "An illustrated databook whose plates come with transcriptions.",
    heading: "Databook reader",
    jsonLd: origin => [
      {
        "@context": "https://schema.org",
        "@type": "Book",
        name: "Illustrated guide",
        url: `${origin}/reader/databook`,
      },
    ],
    body: DatabookPage,
  },
  {
    path: "/reader/collection",
    kind: "reader",
    title: "Collection reader - Aphrody UI",
    description: "Edition and chapter navigation for collections of volumes.",
    heading: "Collection reader",
    jsonLd: origin => [
      {
        "@context": "https://schema.org",
        "@type": "CreativeWorkSeries",
        name: "The complete collection",
        url: `${origin}/reader/collection`,
      },
    ],
    body: CollectionPage,
  },
  {
    path: "/data",
    kind: "data",
    title: "Data - Aphrody UI",
    description: "A package table and a glossary: the plain HTML structures crawlers extract most reliably.",
    heading: "Data and tables",
    jsonLd: origin => [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "Component packages",
        description: "Packages of the Aphrody UI layer",
        url: `${origin}/data`,
      },
    ],
    body: DataPage,
  },
];

export async function renderPages(origin: string): Promise<SitePage[]> {
  const schemeCss = (await m3SchemeCss({}, { noFfi: true })).css;
  return SPECS.map(spec => {
    const Body = spec.body;
    return {
      path: spec.path,
      kind: spec.kind,
      html: `<!DOCTYPE html>${renderToString(
        <Shell spec={spec} origin={origin} schemeCss={schemeCss}>
          <Body />
        </Shell>,
      )}`,
    };
  });
}
