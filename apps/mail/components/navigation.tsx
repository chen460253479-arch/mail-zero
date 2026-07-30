import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuContent,
  ListItem,
} from '@/components/ui/navigation-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { GitHub, Twitter, Discord, LinkedIn } from './icons/icons';
import { Separator } from '@/components/ui/separator';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { m } from '@/paraglide/messages';

const resources = [
  {
    title: m['navigation.public.github'](),
    href: 'https://github.com/Mail-0/Zero',
    description: m['navigation.public.githubDescription'](),
    platform: 'github' as const,
  },
  {
    title: m['navigation.public.twitter'](),
    href: 'https://x.com/mail0dotcom',
    description: m['navigation.public.twitterDescription'](),
    platform: 'twitter' as const,
  },
  {
    title: m['navigation.public.linkedin'](),
    href: 'https://www.linkedin.com/company/mail0/',
    description: m['navigation.public.linkedinDescription'](),
    platform: 'linkedin' as const,
  },
  {
    title: m['navigation.public.discord'](),
    href: 'https://discord.gg/mail0',
    description: m['navigation.public.discordDescription'](),
    platform: 'discord' as const,
  },
];

const aboutLinks = [
  {
    title: m['navigation.public.about'](),
    href: '/about',
    description: m['navigation.public.aboutDescription'](),
  },
  {
    title: m['navigation.public.terms'](),
    href: '/terms',
    description: m['navigation.public.termsDescription'](),
  },
];

const IconComponent = {
  github: GitHub,
  twitter: Twitter,
  discord: Discord,
  linkedin: LinkedIn,
};

export function Navigation() {
  const [open, setOpen] = useState(false);
  const { data: session } = useSession();
  const navigate = useNavigate();

  return (
    <>
      {/* Desktop Navigation - Hidden on mobile */}
      <header className="fixed left-[50%] z-50 hidden w-full max-w-4xl translate-x-[-50%] items-center justify-center px-4 pt-6 lg:flex">
        <nav className="border-input/50 flex w-full max-w-4xl items-center justify-between gap-2 rounded-xl border-t bg-[#1E1E1E] p-3 px-6">
          <div className="flex items-center gap-6">
            <Link to="/" className="relative bottom-1 cursor-pointer">
              <img
                src="white-icon.svg"
                alt={m['navigation.public.zeroEmailLogo']()}
                width={22}
                height={22}
              />
              <span className="text-muted-foreground absolute -right-[-0.5px] text-[10px]">
                {m['navigation.public.beta']()}
              </span>
            </Link>
            <NavigationMenu>
              <NavigationMenuList className="gap-1">
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="cursor-pointer bg-transparent text-white">
                    {m['navigation.public.company']()}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-[300px] gap-3 p-4 md:w-[300px] md:grid-cols-1 lg:w-[400px]">
                      {aboutLinks.map((link) => (
                        <ListItem key={link.title} title={link.title} href={link.href}>
                          {link.description}
                        </ListItem>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="cursor-pointer bg-transparent text-white">
                    {m['navigation.public.resources']()}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px]">
                      {resources.map((resource) => (
                        <ListItem
                          key={resource.title}
                          title={resource.title}
                          href={resource.href}
                          platform={resource.platform}
                        >
                          {resource.description}
                        </ListItem>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>
          <div className="flex gap-2">
            <a
              href="https://github.com/Mail-0/Zero"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'group inline-flex h-8 items-center gap-2 rounded-lg bg-black px-2 text-sm text-white transition-colors hover:bg-black/90',
              )}
            >
              <div className="flex items-center text-white">
                <GitHub className="mr-1 size-4 fill-white" />
                <span className="ml-1 lg:hidden">{m['navigation.public.star']()}</span>
                <span className="ml-1 hidden lg:inline">{m['navigation.public.github']()}</span>
              </div>
            </a>
            <Button
              className="h-8 cursor-pointer bg-white text-black hover:bg-white hover:text-black"
              onClick={() => {
                if (session) {
                  navigate('/mail/inbox');
                } else {
                  navigate('/login');
                }
              }}
            >
              {m['navigation.public.getStarted']()}
            </Button>
          </div>
        </nav>
      </header>

      {/* Mobile Navigation Sheet */}
      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="fixed left-4 top-6 z-50">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] sm:w-[400px] dark:bg-[#111111]">
            <SheetHeader className="flex flex-row items-center justify-between">
              <SheetTitle>
                <Link to="/" onClick={() => setOpen(false)}>
                  <img
                    src="white-icon.svg"
                    alt={m['navigation.public.zeroEmailLogo']()}
                    className="hidden object-contain dark:block"
                    width={22}
                    height={22}
                  />
                  <img
                    src="/black-icon.svg"
                    alt={m['navigation.public.zeroEmailLogo']()}
                    className="object-contain dark:hidden"
                    width={22}
                    height={22}
                  />
                </Link>
              </SheetTitle>
            </SheetHeader>
            <div className="mt-8 flex flex-col space-y-3">
              <div className="flex flex-col space-y-3">
                <Link to="/" onClick={() => setOpen(false)}>
                  {m['navigation.public.home']()}
                </Link>
                {aboutLinks.map((link) => (
                  <a key={link.title} href={link.href} className="block font-medium">
                    {link.title}
                  </a>
                ))}
              </div>
              <a
                target="_blank"
                rel="noreferrer noopener"
                href="https://cal.com/team/0/chat"
                className="font-medium"
              >
                {m['navigation.public.contactUs']()}
              </a>
            </div>
            <Separator className="mt-8" />
            <div className="mt-8 flex flex-row items-center justify-center gap-4">
              {resources.map((resource) => {
                const Icon = IconComponent[resource.platform];
                return (
                  <Link
                    key={resource.title}
                    to={resource.href}
                    className="flex items-center gap-2 font-medium"
                  >
                    {resource.platform && <Icon className="dark:fill-muted-foreground h-5 w-5" />}
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
