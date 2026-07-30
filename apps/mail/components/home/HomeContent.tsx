import {
  ChevronDown,
  Plus,
  Cube,
  MediumStack,
  Clock,
  PanelLeftOpen,
  Check,
  Filter,
  Search,
  User,
  Lightning,
  ExclamationTriangle,
  Bell,
  Tag,
  GroupPeople,
  X,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Figma,
  Docx,
  ImageFile,
} from '../icons/icons';
import { PixelatedBackground, PixelatedLeft, PixelatedRight } from '@/components/home/pixelated-bg';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Balancer } from 'react-wrap-balancer';
import { useSession } from '@/lib/auth-client';
import { Navigation } from '../navigation';
import { useTheme } from 'next-themes';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import Footer from './footer';
import { m } from '@/paraglide/messages';

const tabs = [
  { label: m['pages.home.tabs.localInbox'](), value: 'local-inbox' },
  { label: m['pages.home.tabs.organization'](), value: 'organization' },
  { label: m['pages.home.tabs.delivery'](), value: 'delivery' },
];

export default function HomeContent() {
  const { setTheme } = useTheme();
  const navigate = useNavigate();
  const { data: session } = useSession();

  useEffect(() => {
    setTheme('dark');
  }, [setTheme]);

  return (
    <main className="relative flex h-full flex-1 flex-col overflow-x-hidden bg-[#0F0F0F] px-2">
      <PixelatedBackground
        className="z-1 absolute left-1/2 top-[-40px] h-auto w-screen min-w-[1920px] -translate-x-1/2 object-cover"
        style={{
          mixBlendMode: 'screen',
          maskImage: 'linear-gradient(to bottom, black, transparent)',
        }}
      />

      <Navigation />

      <section className="z-10 mt-32 flex flex-col items-center px-4">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-center text-4xl font-medium md:text-6xl"
        >
          <Balancer className="mb-3 max-w-[1130px]">
            {m['pages.home.heroTitle']()}
          </Balancer>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mx-auto mb-4 max-w-2xl text-center text-base font-medium text-[#B7B7B7] md:text-lg"
        >
          {m['pages.home.heroDescription']()}
        </motion.p>
        <p className="mb-4 ml-0.5 text-xs text-[#B7B7B7]/60">
          {m['pages.home.noCreditCard']()}
        </p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="border-input/50 mb-6 inline-flex items-center gap-4 rounded-full border border-[#2A2A2A] bg-[#1E1E1E] px-4 py-1"
        >
          <Link to="https://yc.vc" target="_blank" className="flex items-center gap-2 text-sm">
            {m['pages.home.backedBy']()}
            <span>
              <img
                src="/yc-small.svg"
                alt={m['pages.home.yCombinator']()}
                className="rounded-[2px]"
                width={18}
                height={18}
              />
            </span>
            {m['pages.home.combinator']()}
          </Link>
        </motion.div>

        {/* Get Started button only visible for mobile screens */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mb-6 lg:hidden"
        >
          <Button
            onClick={() => {
              if (session) {
                navigate('/mail/inbox');
              } else {
                navigate('/login');
              }
            }}
          >
            {m['pages.home.getStarted']()}
          </Button>
        </motion.div>
      </section>

      <section className="relative mt-10 hidden flex-col justify-center md:flex">
        <div className="bg-border absolute left-1/2 top-0 h-px w-full -translate-x-1/2 md:container xl:max-w-7xl" />
        <Tabs
          defaultValue="local-inbox"
          className="flex w-full flex-col items-center gap-0"
        >
          <div
            className="relative bottom-2 flex w-full justify-center md:border-t"
            style={{ clipPath: 'inset(0 0 0 0)', height: '110%' }}
          >
            <div className="container relative -top-1.5 md:border-x xl:max-w-7xl">
              <PixelatedLeft
                className="absolute left-0 top-0 -z-10 hidden h-full w-auto -translate-x-full opacity-50 md:block"
                style={{ mixBlendMode: 'screen' }}
              />
              <PixelatedRight
                className="absolute right-0 top-0 -z-10 hidden h-full w-auto translate-x-full opacity-50 md:block"
                style={{ mixBlendMode: 'screen' }}
              />
              {tabs.map((tab) => (
                <TabsContent key={tab.value} value={tab.value}>
                  <img
                    src="/email-preview.png"
                    alt={m['pages.home.emailPreview']()}
                    width={1920}
                    height={1080}
                    className="relative hidden md:block"
                    loading="eager"
                  />
                </TabsContent>
              ))}
            </div>
          </div>
        </Tabs>
      </section>

      <div className="flex items-center justify-center px-4 md:hidden">
        <img
          src="/email-preview.png"
          alt={m['pages.home.emailPreview']()}
          width={1920}
          height={1080}
          className="mt-10 h-fit w-full rounded-xl border"
          loading="eager"
        />
      </div>

      <div className="relative -top-3.5 hidden h-px w-full bg-[#313135] md:block" />

      <div className="relative mt-52">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-center"
        >
          <h1 className="text-lg font-light text-white/40 md:text-xl">
            {m['pages.home.powerUsers']()}
          </h1>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-2 flex flex-col items-center justify-center md:mt-8"
        >
          <h1 className="text-center text-4xl font-medium text-white md:text-6xl">
            {m['pages.home.speedTitle']()}
          </h1>
          <h1 className="mb-3 text-center text-4xl font-medium text-white/40 md:text-6xl">
            {m['pages.home.speedSubtitle']()}
          </h1>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="relative bottom-3 mx-12 flex items-center justify-center bg-[#0F0F0F] md:mx-0"
        >
          <div className="bg-panelDark mx-auto mt-10 inline-flex max-w-[600px] flex-col items-center justify-center overflow-hidden rounded-2xl shadow-md">
            <div className="inline-flex h-12 items-center justify-start gap-2 self-stretch border-b-[0.50px] p-4">
              <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                {m['pages.home.to']()}
              </div>
              <div className="flex flex-1 items-center justify-start gap-1">
                <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1.5 rounded-full border border-[#2B2B2B] py-1 pl-1 pr-1.5">
                  <img
                    height={20}
                    width={20}
                    className="h-5 w-5 rounded-full"
                    src="/adam.jpg"
                    alt={m['pages.home.adam']()}
                  />
                  <div className="flex items-center justify-start">
                    <div className="flex items-center justify-center gap-2.5 pr-0.5">
                      <div className="text-base-gray-950 justify-start text-sm leading-none">
                        {m['pages.home.adam']()}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1.5 rounded-full border border-[#2B2B2B] py-1 pl-1 pr-1.5">
                  <img
                    height={20}
                    width={20}
                    className="h-5 w-5 rounded-full"
                    src="/ryan.jpg"
                    alt={m['pages.home.ryan']()}
                  />{' '}
                  <div className="flex items-center justify-start">
                    <div className="flex items-center justify-center gap-2.5 pr-0.5">
                      <div className="text-base-gray-950 justify-start text-sm leading-none">
                        {m['pages.home.ryan']()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="inline-flex h-12 items-center justify-start gap-2.5 self-stretch p-4">
              <Clock className="relative h-3.5 w-3.5 overflow-hidden fill-[#9A9A9A]" />
              <div className="inline-flex flex-1 flex-col items-start justify-start gap-3">
                <div className="inline-flex items-center justify-start gap-1 self-stretch">
                  <div className="text-base-gray-950 flex-1 justify-start text-sm font-normal leading-none">
                    {m['pages.home.codeReviewSubject']()}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start justify-start gap-12 self-stretch rounded-2xl bg-[#202020] px-4 py-3">
              <div className="flex flex-col items-start justify-start gap-3 self-stretch">
                <div className="justify-start self-stretch text-sm font-normal leading-normal text-white">
                  {m['pages.home.greeting']()}
                </div>
                <div className="justify-start self-stretch text-sm font-normal leading-normal text-white">
                  {m['pages.home.codeReviewBody']()}
                </div>
                <div className="justify-start self-stretch text-sm font-normal leading-normal text-white">
                  {m['pages.home.codeReviewFollowUp']()}
                </div>
              </div>
              <div className="inline-flex items-center justify-between self-stretch">
                <div className="flex items-center justify-start gap-3">
                  <div className="flex items-center justify-start rounded-md bg-white text-black">
                    <div className="flex h-7 items-center justify-center gap-1.5 overflow-hidden rounded-bl-md rounded-tl-md bg-white pl-1.5 pr-1">
                      <div className="flex items-center justify-center gap-2.5 pl-0.5">
                        <div className="justify-start text-center text-sm leading-none text-black">
                          {m['pages.home.send']()}{' '}
                          <span className="hidden md:inline">{m['pages.home.now']()}</span>
                        </div>
                      </div>
                      <div className="flex h-5 items-center justify-center gap-2.5 rounded bg-[#E7E7E7] px-1 outline outline-1 -outline-offset-1 outline-[#D2D2D2]">
                        <div className="text-tokens-shortcut-primary-symbol justify-start text-center text-sm font-semibold leading-none">
                          ⏎
                        </div>
                      </div>
                    </div>
                    <div className="bg-base-gray-950 flex items-center justify-start gap-2.5 self-stretch px-2 pr-3">
                      <div className="relative h-3 w-px rounded-full bg-[#D0D0D0]" />
                    </div>
                    <div className="bg-base-gray-950 flex h-7 items-center justify-center gap-1.5 overflow-hidden rounded-br-md rounded-tr-md pr-2">
                      <ChevronDown className="relative h-2 w-2 overflow-hidden fill-black" />
                    </div>
                  </div>
                  <div className="flex h-7 items-center justify-center gap-0.5 overflow-hidden rounded-md bg-[#373737] px-1.5">
                    <Plus className="relative h-2.5 w-2.5 overflow-hidden fill-[#9A9A9A]" />
                    <div className="flex items-center justify-center gap-2.5 px-0.5">
                      <div className="text-base-gray-950 justify-start text-sm leading-none">
                        {m['pages.home.add']()}{' '}
                        <span className="hidden md:inline">{m['pages.home.files']()}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="hidden items-start justify-start gap-3 md:flex">
                  <div className="flex h-7 items-center justify-center gap-0.5 overflow-hidden rounded-md bg-[#373737] px-1.5">
                    <Cube className="relative h-3 w-3 overflow-hidden fill-[#9A9A9A]" />

                    <div className="flex items-center justify-center gap-2.5 px-0.5">
                      <div className="text-base-gray-950 justify-start text-sm leading-none">
                        {m['pages.home.neutral']()}
                      </div>
                    </div>
                  </div>
                  <div className="flex h-7 items-center justify-center gap-0.5 overflow-hidden rounded-md bg-[#373737] px-1.5">
                    <MediumStack className="relative mx-1 h-2.5 w-2.5 overflow-hidden fill-[#9A9A9A]" />

                    <div className="flex items-center justify-center gap-2.5 px-0.5">
                      <div className="text-base-gray-950 justify-start text-sm leading-none">
                        {m['pages.home.mediumLength']()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="inline-flex items-start justify-start self-stretch">
              <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                <div className="flex items-center justify-start gap-1">
                  <div className="flex h-5 w-5 items-center justify-center gap-2.5 rounded-[5px] bg-[#2B2B2B] px-1.5">
                    <div className="justify-start text-center text-sm font-semibold leading-none text-[#8C8C8C]">
                      ↓
                    </div>
                  </div>
                  <div className="flex h-5 w-5 items-center justify-center gap-2.5 rounded-[5px] bg-[#2B2B2B] px-1.5">
                    <div className="justify-start text-center text-sm font-semibold leading-none text-[#8C8C8C]">
                      ↑
                    </div>
                  </div>
                </div>
                <div className="justify-start text-sm leading-none text-[#8C8C8C]">
                  {m['pages.home.toNavigate']()}
                </div>
              </div>
              <div className="flex h-12 flex-1 items-center justify-center gap-2">
                <div className="flex h-5 items-center justify-center gap-2.5 rounded-[5px] bg-[#2B2B2B] px-1">
                  <div className="justify-start text-center text-sm font-semibold leading-none text-[#8C8C8C]">
                    ⌘Z
                  </div>
                </div>
                <div className="justify-start text-sm leading-none text-[#8C8C8C]">
                  {m['pages.home.returnGeneration']()}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="relative mt-52 flex items-center justify-center">
        <div className="w-full! mx-auto grid max-w-[1250px] grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl md:h-96">
              <div className="absolute left-0 top-0 aspect-square w-full rounded-2xl border border-[#252525] bg-neutral-800 md:h-96 md:w-96" />
              <div className="outline-tokens-stroke-light/5 bg-panelDark absolute left-1/2 top-[34px] inline-flex h-[771px] w-72 -translate-x-1/2 flex-col items-start justify-start overflow-hidden rounded-lg">
                <div className="inline-flex h-10 items-center justify-start gap-3 self-stretch overflow-hidden border-b-[0.38px] border-[#252525] px-4 py-5">
                  <div className="flex flex-1 items-center justify-start gap-2">
                    <div className="flex flex-1 items-center justify-start gap-1.5">
                      <PanelLeftOpen className="h-3 w-3 fill-[#8C8C8C]" />
                      <div className="ml-1 justify-start text-xs leading-3 text-white">
                        {m['pages.home.inbox']()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-start gap-1">
                    <Check className="h-2.5 w-2.5 fill-[#8C8C8C]" />
                    <div className="justify-start text-xs leading-3 text-[#8C8C8C]">
                      {m['pages.home.select']()}
                    </div>
                  </div>
                  <div className="relative h-2.5 w-[0.76px] rounded-full bg-[#252525]" />
                  <div className="flex items-center justify-start gap-2">
                    <Filter className="relative h-3 w-3 fill-[#8C8C8C]" />
                  </div>
                </div>
                <div className="flex flex-col items-start justify-start gap-3 self-stretch p-4">
                  <div className="inline-flex h-7 items-center justify-start gap-1 self-stretch overflow-hidden rounded bg-[#141414] pl-1.5 pr-[3.04px]">
                    <Search className="relative mr-1 h-3 w-3 overflow-hidden rounded-[1.14px] fill-[#8C8C8C]" />
                    <div className="flex-1 justify-start text-xs leading-3 text-[#929292]">
                      {m['pages.home.search']()}
                    </div>
                    <div className="flex h-5 items-center justify-center gap-2 rounded-sm bg-[#262626] px-1">
                      <div className="justify-start text-xs leading-3 text-[#929292]">⌘K</div>
                    </div>
                  </div>
                  <div className="inline-flex items-start justify-start gap-1.5 self-stretch">
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <Lightning className="relative h-3 w-3 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <ExclamationTriangle className="relative h-3.5 w-3.5 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="flex h-6 flex-1 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#39AE4A] px-2.5">
                      <User className="relative h-3 w-3 overflow-hidden fill-white" />
                      <div className="flex items-center justify-center gap-2 px-[1.52px]">
                        <div className="justify-start text-xs leading-3 text-white">
                          {m['pages.home.personal']()}
                        </div>
                      </div>
                    </div>
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <Bell className="relative h-3 w-3 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <Tag className="relative h-3 w-3 overflow-hidden fill-[#989898]" />
                    </div>
                  </div>
                  <div className="relative flex flex-col items-start justify-center gap-2.5 self-stretch overflow-hidden rounded-md bg-[#12341D] px-2 py-2.5">
                    <div className="justify-start self-stretch text-xs leading-3 text-[#A3E1B3]">
                      {m['pages.home.urgentTitle']()}
                    </div>
                    <div className="justify-start self-stretch text-xs font-normal leading-none text-[#F4FBF6]">
                      {m['pages.home.urgentDescription']()}
                    </div>
                    <div className="absolute left-[239.80px] top-[6.07px] h-3 w-3 overflow-hidden opacity-50" />
                  </div>
                </div>
                <div className="inline-flex items-center justify-start gap-1 self-stretch px-4 pb-3 pt-5">
                  <div className="flex flex-1 items-center justify-start gap-1">
                    <div className="justify-start text-xs leading-3 text-[#8C8C8C]">
                      {m['pages.home.pinned']()}
                    </div>
                    <div className="justify-start text-xs leading-3 text-[#8C8C8C]">[3]</div>
                  </div>
                </div>
                <div className="flex flex-col items-start justify-start gap-1.5 self-stretch px-1.5">
                  <div className="inline-flex items-center justify-start gap-2.5 self-stretch rounded-md p-2.5">
                    <img
                      alt={m['pages.home.nizzy']()}
                      height={250}
                      width={250}
                      className="h-6 w-6 rounded-full object-cover"
                      src="/nizzy.jpg"
                    />
                    <div className="inline-flex h-7 flex-1 flex-col items-start justify-start gap-2">
                      <div className="inline-flex items-start justify-start gap-2 self-stretch">
                        <div className="flex flex-1 items-center justify-start gap-2.5">
                          <div className="flex items-center justify-start gap-[3.04px]">
                            <div className="text-base-gray-950 justify-start text-xs leading-3">
                              {m['pages.home.nizzy']()}
                            </div>
                            <div className="justify-start text-center text-xs leading-3 text-[#8C8C8C]">
                              [9]
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">
                          {m['pages.home.mar29']()}
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-2 self-stretch">
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">
                          {m['pages.home.newDesignReview']()}
                        </div>
                        <div className="flex items-start justify-start gap-[3.04px]">
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="inline-flex items-center justify-start gap-2.5 self-stretch rounded-lg p-2.5">
                    <div className="inline-flex h-6 w-6 flex-col items-center justify-center gap-2 overflow-hidden rounded-full bg-[#313131] px-1 py-2">
                      <GroupPeople className="relative h-5 w-5 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="inline-flex flex-1 flex-col items-start justify-start gap-2">
                      <div className="inline-flex items-start justify-start gap-2 self-stretch">
                        <div className="flex flex-1 items-center justify-start gap-2.5">
                          <div className="flex items-center justify-start gap-1">
                            <div className="text-base-gray-950 justify-start text-xs leading-3">
                              {m['pages.home.participants']()}
                            </div>
                            <div className="justify-start text-center text-xs leading-3 text-[#8C8C8C]">
                              [6]
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">
                          {m['pages.home.mar28']()}
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-2 self-stretch">
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">
                          {m['pages.home.designReviewSubject']()}
                        </div>
                        <div className="flex items-start justify-start gap-[3.04px]">
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 gap-4">
              <h1 className="mb-2 text-xl font-medium leading-loose text-white">
                {m['pages.home.interfaceTitle']()}
              </h1>
              <p className="max-w-sm text-sm font-light text-[#979797]">
                {m['pages.home.interfaceDescription']()}
              </p>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl md:h-96">
              <div className="absolute left-0 top-0 aspect-square w-full rounded-2xl bg-[#2B2B2B] md:h-96 md:w-96" />
              <div className="absolute left-[44px] top-0 h-[720px] w-[610px]">
                <div className="absolute left-[31px] top-[29px] inline-flex h-[720px] w-[547px] flex-col items-start justify-start overflow-hidden rounded-lg bg-[#202020] opacity-20">
                  <div className="border-tokens-stroke-light/5 inline-flex h-9 items-center justify-between self-stretch overflow-hidden border-b-[0.35px] py-3 pl-3.5 pr-2">
                    <div className="flex items-center justify-start gap-3">
                      <X className="relative h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                      <div className="relative h-2 w-[0.71px] rounded-full bg-[#2B2B2B]" />
                      <div className="flex items-center justify-start gap-2">
                        <ChevronLeft className="relative h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                        <ChevronRight className="relative h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-4 w-4 overflow-hidden">
                          <div className="bg-base-warning-500 absolute left-[5.37px] top-[3.90px] h-2.5 w-1.5" />
                        </div>
                      </div>
                      <div className="bg-tokens-stroke-light/5 relative h-2 w-[0.71px] rounded-full" />
                      <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center gap-[1.42px] overflow-hidden rounded px-1">
                        <div className="relative h-3 w-3" />
                        <div className="flex items-center justify-center gap-2 pl-[0.71px] pr-[1.42px]">
                          <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                            {m['pages.home.replyAll']()}
                          </div>
                        </div>
                      </div>
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-3 w-3 overflow-hidden" />
                      </div>
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-3 w-3" />
                      </div>
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-3 w-3 overflow-hidden" />
                      </div>
                      <div className="bg-base-danger-100 outline-base-danger-200 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded outline outline-[0.35px]">
                        <div className="relative h-3 w-3 overflow-hidden" />
                      </div>
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex flex-col items-start justify-start gap-6 self-stretch overflow-hidden border-b-[0.35px] p-3.5">
                    <div className="flex flex-col items-start justify-start gap-4 self-stretch">
                      <div className="flex flex-col items-start justify-start gap-2.5 self-stretch">
                        <div className="inline-flex items-start justify-start gap-[2.83px] self-stretch">
                          <div className="text-base-gray-950 justify-start text-xs leading-3">
                            {m['pages.home.designReviewSubject']()}
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-center text-xs leading-3">
                            [6]
                          </div>
                        </div>
                        <div className="inline-flex items-start justify-start gap-1 self-stretch">
                          <Calendar className="relative bottom-px h-2.5 w-2.5 overflow-hidden fill-[#8C8C8C]" />
                          <div className="text-base-gray-500/50 flex-1 justify-start text-[9.92px] font-normal leading-[9.92px]">
                            {m['pages.home.dateRange']()}
                          </div>
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-3">
                        <div className="flex items-center justify-start gap-1 overflow-hidden shadow-[0px_0.7086613774299622px_1.4173227548599243px_0px_rgba(255,255,255,0.00)] shadow-[0px_0px_0px_0.3543306887149811px_rgba(255,255,255,0.00)]">
                          <div className="flex items-center justify-start">
                            <div className="bg-base-success-500 outline-tokens-surface-secondary flex h-5 w-5 items-center justify-center gap-[2.83px] rounded px-2 outline outline-1">
                              <div className="relative h-3 w-3 overflow-hidden" />
                            </div>
                            <div className="bg-base-secondary-500 flex h-5 w-5 items-center justify-center gap-[2.83px] rounded px-2">
                              <div className="relative h-3 w-3 overflow-hidden" />
                            </div>
                          </div>
                          <div className="relative h-3 w-3 overflow-hidden" />
                        </div>
                        <div className="bg-tokens-stroke-light/5 relative h-2 w-[0.71px] rounded-full" />
                        <div className="flex items-center justify-start gap-[2.83px]">
                          <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1 overflow-hidden rounded-full py-[2.83px] pl-[2.83px] pr-2 outline outline-[0.35px] outline-offset-[-0.35px]">
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-200 text-[7px] text-neutral-700">
                              A
                            </span>
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              {m['pages.home.ali']()}
                            </div>
                          </div>
                          <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1 overflow-hidden rounded-full py-[2.83px] pl-[2.83px] pr-2 outline outline-[0.35px] outline-offset-[-0.35px]">
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-200 text-[7px] text-neutral-700">
                              N
                            </span>
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              {m['pages.home.nick']()}
                            </div>
                          </div>
                          <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1 overflow-hidden rounded-full py-[2.83px] pl-[2.83px] pr-2 outline outline-[0.35px] outline-offset-[-0.35px]">
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-200 text-[7px] text-neutral-700">
                              S
                            </span>
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              {m['pages.home.sarah']()}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-tokens-surface-on-secondary/5 outline-base-secondary-500 flex flex-col items-start justify-start gap-3.5 self-stretch rounded-lg p-3 outline outline-[0.35px] outline-offset-[-0.35px]">
                      <div className="inline-flex items-center justify-start gap-1">
                        <div className="justify-start text-[9.92px] leading-[9.92px] text-[#948CA4]">
                          {m['pages.home.threadNote']()}
                        </div>
                      </div>
                      <div className="text-base-gray-950 justify-start self-stretch text-[9.92px] font-normal leading-none">
                        {m['pages.home.threadNoteBody']()}
                      </div>
                    </div>
                    <div className="flex flex-col items-start justify-start gap-2.5 self-stretch">
                      <div className="inline-flex items-center justify-start gap-[2.83px]">
                        <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                          {m['pages.home.attachments']()}
                        </div>
                        <div className="text-base-gray-500/50 justify-start text-center text-[9.92px] leading-[9.92px]">
                          [4]
                        </div>
                      </div>
                      <div className="inline-flex flex-wrap content-start items-start justify-start gap-2 self-stretch">
                        <div className="outline-tokens-stroke-element/0 flex h-5 items-center justify-start gap-1 overflow-hidden rounded bg-[#26232C] px-1.5 py-1 shadow">
                          <div className="relative overflow-hidden">
                            <Figma className="relative h-2 w-2 overflow-hidden" />
                          </div>
                          <div className="flex items-center justify-start gap-[2.83px]">
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              {m['pages.home.figmaAttachment']()}
                            </div>
                            <div className="justify-start text-[9.92px] leading-[9.92px] opacity-50">
                              {m['pages.home.figmaAttachmentSize']()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-start gap-1 overflow-hidden rounded bg-[#26232C] py-1 pl-1 pr-1.5 shadow">
                          <Docx className="relative h-2 w-2 overflow-hidden fill-blue-500" />
                          <div className="flex items-center justify-start gap-[2.83px]">
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              {m['pages.home.documentAttachment']()}
                            </div>
                            <div className="justify-start text-[9.92px] leading-[9.92px] opacity-50">
                              {m['pages.home.documentAttachmentSize']()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-start gap-1 overflow-hidden rounded bg-[#26232C] py-1 pl-1 pr-1.5 shadow">
                          <ImageFile className="relative h-2 w-2 overflow-hidden fill-purple-500" />
                          <div className="flex items-center justify-start gap-[2.83px]">
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              {m['pages.home.imageAttachment']()}
                            </div>
                            <div className="justify-start text-[9.92px] leading-[9.92px] opacity-50">
                              {m['pages.home.imageAttachmentSize']()}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex-col items-start justify-start gap-6 self-stretch overflow-hidden border-b-[0.35px] p-3.5">
                    <div className="inline-flex items-center justify-start gap-3 self-stretch">
                      <img
                        alt={m['pages.home.ahmet']()}
                        height={200}
                        width={200}
                        className="h-6 w-6 rounded-full"
                        src="/ahmet.jpg"
                      />
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2">
                        <div className="inline-flex items-start justify-start gap-2 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-2">
                            <div className="flex items-center justify-start gap-[2.83px]">
                              <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                                {m['pages.home.ahmet']()}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-[2.83px] self-stretch opacity-50">
                          <div className="text-base-gray-500/50 justify-start text-[9.92px] font-normal leading-[9.92px]">
                            {m['pages.home.to']()}
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-[9.92px] font-normal leading-[9.92px]">
                            {m['pages.home.participants']()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="from-tokens-scroll-overlay-primary to-tokens-scroll-overlay-top/0 bg-linear-to-l absolute left-0 top-[668.98px] h-12 w-[547.09px]" />
                </div>
                <div className="absolute left-0 top-[121px] inline-flex w-[650px] flex-col items-start justify-start gap-4 overflow-hidden rounded-3xl border border-[#8B5CF6] bg-[#2A1D48] p-6 outline outline-[#3F325F]">
                  <div className="inline-flex items-center justify-start gap-1.5">
                    <div className="relative h-3.5 w-3.5">
                      <img
                        src="/star.svg"
                        alt={m['pages.home.threadNote']()}
                        width={16}
                        height={16}
                      />
                    </div>
                    <div className="flex items-center justify-start gap-1 text-xs leading-3 text-[#948CA4]">
                      {m['pages.home.threadNote']()}
                      <ChevronDown className="relative h-2 w-2 overflow-hidden fill-[#8C8C8C]" />
                    </div>
                  </div>
                  <div className="justify-start self-stretch text-base font-normal leading-snug text-white">
                    {m['pages.home.threadNoteBody']()}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <h1 className="mb-2 mt-4 text-lg font-medium leading-loose text-white">
                {m['pages.home.threadContextTitle']()}
              </h1>
              <p className="max-w-sm text-sm font-light text-[#979797]">
                {m['pages.home.threadContextDescription']()}
              </p>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl md:h-96">
              <div className="absolute left-0 top-0 aspect-square w-full rounded-2xl bg-[#2B2B2B] md:h-96 md:w-96" />
              <div className="bg-panelDark absolute left-[34px] top-[34px] inline-flex w-[600px] flex-col items-start justify-start overflow-hidden rounded-xl">
                <div className="bg-tokens-surface-secondary border-tokens-stroke-light/5 inline-flex h-12 items-center justify-center gap-3 self-stretch overflow-hidden border-b-[0.50px] px-4 py-3">
                  <div className="flex h-6 items-center justify-center overflow-hidden rounded bg-[#262626] pl-1 pr-1.5">
                    <X className="relative h-3.5 w-3.5 overflow-hidden fill-[#767676]" />
                    <div className="flex items-center justify-center gap-2.5 px-0.5 text-[#767676]">
                      esc
                    </div>
                  </div>
                  <div className="flex flex-1 items-center justify-start gap-1">
                    <div className="relative w-px self-stretch rounded-full bg-[#767676]" />
                    <div className="flex-1 justify-center text-sm font-normal leading-none text-[#767676]">
                      {m['pages.home.searchPlaceholder']()}
                    </div>
                  </div>
                </div>
                <div className="bg-tokens-surface-secondary border-tokens-stroke-light/5 flex flex-col items-start justify-start self-stretch overflow-hidden border-b-[0.50px]">
                  <div className="inline-flex items-center justify-start gap-1.5 self-stretch px-5 pb-3 pt-5">
                    <div className="flex-1 justify-start text-sm leading-none text-[#8C8C8C]">
                      {m['pages.home.recentlyInteracted']()}
                    </div>
                  </div>
                  <div className="flex flex-col items-start justify-start gap-2 self-stretch p-2">
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="relative h-8 w-8 rounded-full bg-indigo-500/10">
                        <div className="absolute left-[10.2px] top-[4px] h-7 w-3 overflow-hidden">
                          <img
                            src="/stripe.svg"
                            alt={m['pages.home.stripe']()}
                            width={12}
                            height={24}
                            className="w-18 absolute h-6"
                          />
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                {m['pages.home.stripe']()}
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            {m['pages.home.mar29']()}
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                            {m['pages.home.paymentConfirmation']()}
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="relative h-8 w-8 rounded-full bg-red-600/10">
                        <div className="absolute left-0 top-0 h-8 w-8 rounded-full" />
                        <div className="absolute left-[11px] top-[4px] h-7 w-2.5">
                          <img
                            src="/netflix.svg"
                            alt={m['pages.home.netflix']()}
                            width={12}
                            height={24}
                            className="w-18 absolute h-6"
                          />
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                {m['pages.home.netflix']()}
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            {m['pages.home.mar29']()}
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                            {m['pages.home.netflixUpdate']()}
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-[10px] bg-[#202020] p-3">
                      <img
                        className="h-8 w-8 rounded-full"
                        src="/dudu.jpg"
                        alt={m['pages.home.dudu']()}
                        width={32}
                        height={32}
                      />
                      <div className="inline-flex h-9 flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                {m['pages.home.dudu']()}
                              </div>
                              <div className="justify-start text-center text-sm leading-none text-[#8C8C8C]">
                                [9]
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            {m['pages.home.mar29']()}
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                            {m['pages.home.newDesignReview']()}
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-full bg-[#2B2B2B]">
                        <div className="relative h-8 w-8 overflow-hidden">
                          <div className="absolute left-[10.60px] top-[8px] h-4 w-2.5 overflow-hidden">
                            <Figma className="relative h-4 w-2.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                {m['pages.home.figma']()}
                              </div>
                              <div className="justify-start text-center text-sm leading-none text-[#8C8C8C]">
                                [5]
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            {m['pages.home.mar26']()}
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="text-base-gray-500/50 flex-1 justify-start text-sm font-normal leading-none">
                            {m['pages.home.figmaComment']()}
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-full bg-red-500/10 px-1.5 py-2.5">
                        <div className="relative h-8 w-8 overflow-hidden">
                          <div className="absolute left-[7.30px] top-[7px] h-4 w-4 overflow-hidden">
                            <div className="absolute left-0 top-0 h-4 w-4 bg-red-500" />
                          </div>
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                {m['pages.home.asana']()}
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            {m['pages.home.mar25']()}
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="text-base-gray-500/50 flex-1 justify-start text-sm font-normal leading-none">
                            {m['pages.home.weeklySummary']()}
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="relative inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 rounded-full px-1.5 py-2.5">
                        <div className="bg-base-primary-500 outline-tokens-surface-secondary absolute left-[24px] top-[24px] h-2 w-2 rounded-full outline outline-2" />
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                {m['pages.home.nick']()}
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            {m['pages.home.mar28']()}
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="text-base-gray-500/50 flex-1 justify-start text-sm font-normal leading-none">
                            {m['pages.home.coffeeNextWeek']()}
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="inline-flex items-center justify-between self-stretch overflow-hidden">
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1.5">
                      <div className="bg-base-gray-500/50 h-2 w-3" />
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      {m['pages.home.open']()}
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1">
                      <div className="text-base-gray-500/50 justify-start text-center text-sm leading-none">
                        ⌘R
                      </div>
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      {m['pages.home.reply']()}
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1">
                      <div className="text-base-gray-500/50 justify-start text-center text-sm leading-none">
                        ⌘E
                      </div>
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      {m['pages.home.archive']()}
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1">
                      <div className="text-base-gray-500/50 justify-start text-center text-sm leading-none">
                        ⌘M
                      </div>
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      {m['pages.home.markRead']()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <h1 className="mb-2 text-lg font-medium leading-loose text-white">
                {m['pages.home.localSearchTitle']()}
              </h1>
              <p className="max-w-sm text-sm font-light text-[#979797]">
                {m['pages.home.localSearchDescription']()}
              </p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative hidden lg:block"
      >
        <div className="mx-auto max-w-[920px] text-center text-4xl font-normal leading-[48px] text-white">
          <span className="text-[#B7B7B7]">Work smarter, not harder.</span>{' '}
          <span className="pr-12 text-white">Automate repetitive</span>{' '}
          <span className="text-[#B7B7B7]">email</span>
          <span className="text-[#B7B7B7]"> tasks with</span>{' '}
          <span className="pr-14 text-white">smart templates, </span>{' '}
          <span className="text-white">scheduled sends</span>
          <span className="text-[#B7B7B7]">
            , follow-up reminders, and batch processing capabilities that
          </span>{' '}
          <br />
          <span className="text-white underline">save hours every week.</span>
        </div>
        <div className="flex items-center justify-center">
          <img
            className="relative bottom-12 right-[162px]"
            src="/verified-home.png"
            alt="tasks"
            width={50}
            height={50}
          />
          <img
            className="relative bottom-[145px] right-[47px]"
            src="/snooze-home.png"
            alt="tasks"
            width={50}
            height={50}
          />
          <img
            className="relative bottom-[195px] left-[210px]"
            src="/star-home.png"
            alt="tasks"
            width={50}
            height={50}
          />
        </div>
      </motion.div> */}

      <div className="relative mt-52 flex items-center justify-center">
        <Footer />
      </div>
    </main>
  );
}
