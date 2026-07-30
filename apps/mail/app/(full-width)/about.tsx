import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Github, Mail, ArrowLeft } from 'lucide-react';

import Footer from '@/components/home/footer';
import { Navigation } from '@/components/navigation';
import { Button } from '@/components/ui/button';
import { m } from '@/paraglide/messages';

export default function AboutPage() {
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
              {m['pages.about.back']()}
            </Button>
          </a>
        </div>

        <div className="container mx-auto max-w-4xl px-4 py-16">
          <Card className="overflow-hidden rounded-xl border-none bg-gray-50/80 dark:bg-transparent">
            <CardHeader className="space-y-4 px-8 py-8">
              <div className="space-y-2 text-center">
                <CardTitle className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl dark:text-white">
                  {m['pages.about.title']()}
                </CardTitle>
              </div>
            </CardHeader>

            <div className="space-y-8 p-8">
              {sections.map((section) => (
                <div key={section.title} className="p-6">
                  <h2 className="mb-4 text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                    {section.title}
                  </h2>
                  <div className="prose prose-sm prose-a:text-blue-600 hover:prose-a:text-blue-800 dark:prose-a:text-blue-400 dark:hover:prose-a:text-blue-300 max-w-none text-gray-600 dark:text-white/80">
                    {section.content}
                  </div>
                </div>
              ))}
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
    title: m['pages.about.missionTitle'](),
    content: <p>{m['pages.about.mission']()}</p>,
  },
  {
    title: m['pages.about.startedTitle'](),
    content: <p>{m['pages.about.started']()}</p>,
  },
  {
    title: m['pages.about.openSourceTitle'](),
    content: (
      <div className="space-y-4">
        <p>{m['pages.about.openSourceIntro']()}</p>
        <ul className="ml-4 list-disc space-y-2">
          <li>{m['pages.about.openSourceReview']()}</li>
          <li>{m['pages.about.openSourceContribute']()}</li>
          <li>{m['pages.about.openSourceSelfHost']()}</li>
          <li>{m['pages.about.openSourceLearn']()}</li>
        </ul>
        <p>{m['pages.about.openSourceConclusion']()}</p>
      </div>
    ),
  },
  {
    title: m['pages.about.journeyTitle'](),
    content: (
      <div className="space-y-4">
        <p>{m['pages.about.journeyEarlyAccess']()}</p>
        <p>{m['pages.about.journeyOpportunity']()}</p>
      </div>
    ),
  },
  {
    title: m['pages.about.foundersTitle'](),
    content: (
      <div className="space-y-4">
        <p>{m['pages.about.foundersBackground']()}</p>
        <p>{m['pages.about.foundersBelief']()}</p>
      </div>
    ),
  },
  {
    title: m['pages.about.contactTitle'](),
    content: (
      <div className="space-y-3">
        <p>{m['pages.about.contactIntro']()}</p>
        <div className="flex flex-col space-y-2">
          <a
            href="mailto:founders@0.email"
            className="inline-flex items-center text-blue-400 hover:text-blue-300"
          >
            <Mail className="mr-2 h-4 w-4" />
            founders@0.email
          </a>
          <a
            href="https://github.com/Mail-0/Zero"
            className="inline-flex items-center text-blue-400 hover:text-blue-300"
          >
            <Github className="mr-2 h-4 w-4" />
            {m['pages.about.openGithubIssue']()}
          </a>
        </div>
      </div>
    ),
  },
];
