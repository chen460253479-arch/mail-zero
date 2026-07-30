import React from 'react';
import { Github, ArrowLeft, Link2 } from 'lucide-react';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import Footer from '@/components/home/footer';
import { Navigation } from '@/components/navigation';
import { Button } from '@/components/ui/button';
import { createSectionId } from '@/lib/utils';
import { m } from '@/paraglide/messages';

export default function TermsOfService() {
  const { copiedValue: copiedSection, copyToClipboard } = useCopyToClipboard();

  const handleCopyLink = (sectionId: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${sectionId}`;
    copyToClipboard(url, sectionId);
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-auto bg-white dark:bg-[#111111]">
      <Navigation />
      <div className="relative z-10 flex grow flex-col">
        <div className="absolute right-4 top-6 md:left-8 md:right-auto md:top-8">
          <a href="/">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-gray-600 hover:text-gray-900 dark:text-white dark:hover:text-white/80"
            >
              <ArrowLeft className="h-4 w-4" />
              {m['pages.terms.back']()}
            </Button>
          </a>
        </div>

        <div className="container mx-auto max-w-4xl px-4 py-16">
          <Card className="overflow-hidden rounded-xl border-none bg-gray-50/80 dark:bg-transparent">
            <CardHeader className="space-y-4 px-8 py-8">
              <div className="space-y-2 text-center">
                <CardTitle className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl dark:text-white">
                  {m['pages.terms.title']()}
                </CardTitle>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-sm text-gray-500 dark:text-white/60">
                    {m['pages.terms.lastUpdated']({ date: m['pages.terms.lastUpdatedDate']() })}
                  </p>
                </div>
              </div>
            </CardHeader>

            <div className="space-y-8 p-8">
              {sections.map((section) => {
                const sectionId = createSectionId(section.title);
                return (
                  <div key={section.title} id={sectionId} className="p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                        {section.title}
                      </h2>
                      <button
                        onClick={() => handleCopyLink(sectionId)}
                        className="text-gray-400 hover:text-gray-700 dark:text-white/60 dark:hover:text-white/80"
                        aria-label={m['pages.terms.copySectionLink']({
                          section: section.title,
                        })}
                      >
                        <Link2
                          className={`h-4 w-4 ${copiedSection === sectionId ? 'text-green-500 dark:text-green-400' : ''}`}
                        />
                      </button>
                    </div>
                    <div className="prose prose-sm prose-a:text-blue-600 hover:prose-a:text-blue-800 dark:prose-a:text-blue-400 dark:hover:prose-a:text-blue-300 max-w-none text-gray-600 dark:text-white/80">
                      {section.content}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <Footer />
      </div>
    </div>
  );
}

const sections = [
  {
    title: m['pages.terms.overviewTitle'](),
    content: <p>{m['pages.terms.overview']()}</p>,
  },
  {
    title: m['pages.terms.serviceTitle'](),
    content: (
      <div className="space-y-8">
        <div>
          <h3 className="text-card-foreground mb-3 text-xl font-medium">
            {m['pages.terms.selfHostedTitle']()}
          </h3>
          <ul className="ml-4 list-disc space-y-2">
            <li>{m['pages.terms.selfHostedDeploy']()}</li>
            <li>{m['pages.terms.selfHostedResponsibility']()}</li>
            <li>{m['pages.terms.selfHostedLicense']()}</li>
          </ul>
        </div>
        <div>
          <h3 className="text-card-foreground mb-3 text-xl font-medium">
            {m['pages.terms.externalIntegrationTitle']()}
          </h3>
          <ul className="ml-4 list-disc space-y-2">
            <li>{m['pages.terms.externalIntegrationProviders']()}</li>
            <li>{m['pages.terms.externalIntegrationTerms']()}</li>
            <li>{m['pages.terms.externalIntegrationDisruptions']()}</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    title: m['pages.terms.responsibilitiesTitle'](),
    content: (
      <div className="text-muted-foreground mt-4 space-y-3">
        <p>{m['pages.terms.responsibilitiesIntro']()}</p>
        <ul className="ml-4 list-disc space-y-2">
          <li>{m['pages.terms.responsibilityLaws']()}</li>
          <li>{m['pages.terms.responsibilitySecurity']()}</li>
          <li>{m['pages.terms.responsibilityNoSpam']()}</li>
          <li>{m['pages.terms.responsibilityIntellectualProperty']()}</li>
          <li>{m['pages.terms.responsibilityReportSecurity']()}</li>
        </ul>
      </div>
    ),
  },
  {
    title: m['pages.terms.licenseTitle'](),
    content: (
      <div className="text-muted-foreground mt-4 space-y-3">
        <p>{m['pages.terms.licenseIntro']()}</p>
        <ul className="ml-4 list-disc space-y-2">
          <li>{m['pages.terms.licenseUse']()}</li>
          <li>{m['pages.terms.licenseWarranty']()}</li>
          <li>{m['pages.terms.licenseNotice']()}</li>
        </ul>
      </div>
    ),
  },
  {
    title: m['pages.terms.communityTitle'](),
    content: (
      <div className="text-muted-foreground mt-4 space-y-3">
        <p>{m['pages.terms.communityIntro']()}</p>
        <ul className="ml-4 list-disc space-y-2">
          <li>{m['pages.terms.communityConduct']()}</li>
          <li>{m['pages.terms.communityConstructive']()}</li>
          <li>{m['pages.terms.communityRespect']()}</li>
          <li>{m['pages.terms.communityReport']()}</li>
        </ul>
      </div>
    ),
  },
  {
    title: m['pages.terms.contactTitle'](),
    content: (
      <div className="text-muted-foreground mt-4 space-y-3">
        <p>{m['pages.terms.contactIntro']()}</p>
        <div className="flex flex-col space-y-2">
          <a
            href="https://github.com/Mail-0/Zero"
            className="inline-flex items-center text-blue-600 hover:text-blue-800"
          >
            <Github className="mr-2 h-4 w-4" />
            {m['pages.terms.openGithubIssue']()}
          </a>
        </div>
      </div>
    ),
  },
];
