import React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Preview,
  Heading,
} from '@react-email/components';

// Common styles
const main = {
  backgroundColor: '#ffffff',
  fontFamily: '"Helvetica Neue",Helvetica,Arial,sans-serif',
};

const container = {
  margin: '0',
  padding: '20px 0 48px',
  maxWidth: '560px',
};

const section = {
  padding: '0 24px',
};

const h1 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: '600',
  lineHeight: '1.3',
  margin: '0 0 20px',
};

const text = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 16px',
};

const listItem = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 8px',
  paddingLeft: '12px',
};

const link = {
  color: '#007ee6',
  textDecoration: 'underline',
};

const signature = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '20px 0 0',
  fontWeight: '500',
};

interface EmailProps {
  name?: string;
}

// 1. Welcome Email (On Signup)
export const WelcomeEmail = ({ name }: EmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Mail0 👋 Your inbox just leveled up</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Heading style={h1}>Welcome to Mail0 👋</Heading>
            <Text style={text}>Hey {name ? name : 'there'},</Text>
            <Text style={text}>
              I'm Nizzy, founder of Mail0 (aka Zero)
            </Text>
            <Text style={text}>
              If you've ever screamed into the void trying to find that one email thread from 6 months ago, 
              or spent 10 minutes writing "sounds good," you're in the right place 😅
            </Text>
            <Text style={text}>Mail0 is built different:</Text>
            <Text style={listItem}>• AI-native from day one</Text>
            <Text style={listItem}>• Open-source and self-hostable</Text>
            <Text style={listItem}>• Summarizes long threads, drafts replies, and lets you search your inbox like a conversation</Text>
            <Text style={listItem}>• Respects your privacy and your time</Text>
            <Text style={text}>
              It's still early. It's raw. But it's real. And it's yours 💪
            </Text>
            <Text style={text}>
              Mail0 is for people like us: curious, technical, and tired of bloated tools pretending to be minimal 🙃
            </Text>
            <Text style={text}>
              Want to chat about email and get a $20 gift card to anywhere you like?{' '}
              <Link href="https://cal.com/team/0/chat?overlayCalendar=true" style={link}>
                Book some time with me here
              </Link>
            </Text>
            <Text style={text}>
              Thanks for being one of the first to join this journey 🚀
            </Text>
            <Text style={signature}>Nizzy</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// 3. Auto Labeling (2 Days After Signup)
export const AutoLabelingEmail = ({ name }: EmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>New in Mail0: Auto-labeling is here 🎉📥</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Heading style={h1}>New in Mail0: Auto-labeling is here 🎉📥</Heading>
            <Text style={text}>Hey {name ? name : 'there'} 👋</Text>
            <Text style={text}>
              Your inbox just got a whole lot smarter.
            </Text>
            <Text style={text}>
              Mail0 now automatically labels your emails based on what they're about. 
              No setup, no filters, no wasted time 🙌
            </Text>
            <Text style={text}>Here's what it does:</Text>
            <Text style={listItem}>📌 Sorts things into helpful categories like Newsletters, Receipts, Invites, and more</Text>
            <Text style={listItem}>🧠 Learns from your habits to get better over time</Text>
            <Text style={listItem}>🛠️ Lets you rename or tweak labels however you want</Text>
            <Text style={text}>
              It's one of those little features that quietly saves you hours every week ⏳
            </Text>
            <Text style={text}>
              Curious how labeling works behind the scenes?{' '}
              <Link href="https://cal.com/team/0/chat?overlayCalendar=true" style={link}>
                Book a quick chat and I'll send you a $20 gift card as a thank you
              </Link>
            </Text>
            <Text style={text}>
              Thanks for being here,
            </Text>
            <Text style={signature}>Nizzy</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// 4. AI Writing Assistant (3 Days After Signup)
export const AIWritingAssistantEmail = ({ name }: EmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Write faster with AI ✍️✨</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Heading style={h1}>Write faster with AI ✍️✨</Heading>
            <Text style={text}>Hey {name ? name : 'there'} 👋</Text>
            <Text style={text}>
              Tired of writing the same replies over and over? Yeah, same. 
              That's why we built AI Response Assist.
            </Text>
            <Text style={text}>Here's what it can do:</Text>
            <Text style={listItem}>🤖 Reads the email you got</Text>
            <Text style={listItem}>📝 Suggests a thoughtful reply (not a robotic one)</Text>
            <Text style={listItem}>⚡ Lets you tweak, shorten, or send it as-is</Text>
            <Text style={text}>
              No need to overthink every "Sounds good" or "Thanks for following up".
            </Text>
            <Text style={text}>
              It's fast. It sounds like you. And it gets smarter the more you use it.
            </Text>
            <Text style={text}>
              Next time you open an email, try hitting "Generate" and watch the magic happen ✨
            </Text>
            <Text style={text}>
              Want to see it in action or share your thoughts?{' '}
              <Link href="https://cal.com/team/0/chat?overlayCalendar=true" style={link}>
                I'll send you a $20 gift card just for booking a quick call
              </Link>
            </Text>
            <Text style={text}>
              Talk soon,
            </Text>
            <Text style={signature}>Adam</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// 5. Shortcuts (4 Days After Signup)
export const ShortcutsEmail = ({ name }: EmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Fly through your inbox with shortcuts ⚡️</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Heading style={h1}>Fly through your inbox with shortcuts ⚡️</Heading>
            <Text style={text}>Hey {name ? name : 'there'},</Text>
            <Text style={text}>
              You don't need to click around to get things done in Mail0. 
              We've got a full set of keyboard shortcuts built in. And yes, they're fully customizable.
            </Text>
            <Text style={text}>Here are a few worth memorizing:</Text>
            <Text style={listItem}>• C to start a new email</Text>
            <Text style={listItem}>• R to reply</Text>
            <Text style={listItem}>• E to archive a thread</Text>
            <Text style={listItem}>• V to open the voice assistant</Text>
            <Text style={listItem}>• Cmd + K to launch the command palette</Text>
            <Text style={listItem}>• G + I to go to your inbox</Text>
            <Text style={listItem}>• Cmd + Z to undo the last thing you did (life saver)</Text>
            <Text style={text}>
              Want to bulk delete, mark as important, or jump between categories? 
              We've got shortcuts for those too. Just hit ? in the app to view and edit them all.
            </Text>
            <Text style={text}>
              Once you get into the flow, it's wild how fast you move.
            </Text>
            <Text style={text}>
              Got feedback or shortcut ideas?{' '}
              <Link href="https://cal.com/team/0/chat?overlayCalendar=true" style={link}>
                Let's talk and I'll send you a $20 gift card for your time
              </Link>
            </Text>
            <Text style={text}>
              Let's make your inbox feel like second nature.
            </Text>
            <Text style={signature}>Adam</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// 6. Categories (5 Days After Signup)
export const CategoriesEmail = ({ name }: EmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Inbox chaos? We cleaned it up for you 🧼📥</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Heading style={h1}>Inbox chaos? We cleaned it up for you 🧼📥</Heading>
            <Text style={text}>Hey {name ? name : 'there'},</Text>
            <Text style={text}>
              Nobody has time to dig through a messy inbox. 
              That's why Mail0 now automatically sorts your emails into smart categories right at the top of your inbox.
            </Text>
            <Text style={text}>Here's what you'll see:</Text>
            <Text style={listItem}>⚡ Primary — real conversations, people who matter</Text>
            <Text style={listItem}>⚠️ Warnings — account alerts and security stuff</Text>
            <Text style={listItem}>👤 Personal — messages from friends and family</Text>
            <Text style={listItem}>🔔 Notifications — updates, confirmations, reminders</Text>
            <Text style={listItem}>📢 Promotions — marketing, newsletters, and the rest</Text>
            <Text style={text}>
              Mail0 figures it out based on the content of each email. No setup required. 
              Just open your inbox and enjoy the clarity.
            </Text>
            <Text style={text}>
              You can rename, hide, or reorder the categories any way you like.
            </Text>
            <Text style={text}>
              Want to customize categories or suggest improvements?{' '}
              <Link href="https://cal.com/team/0/chat?overlayCalendar=true" style={link}>
                Book a quick chat with me and I'll send you a $20 gift card
              </Link>
            </Text>
            <Text style={text}>
              Talk soon,
            </Text>
            <Text style={signature}>Adam</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// 7. Super Search (6 Days After Signup)
export const SuperSearchEmail = ({ name }: EmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Search your inbox like you talk 🧠🔍</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Heading style={h1}>Search your inbox like you talk 🧠🔍</Heading>
            <Text style={text}>Hey {name ? name : 'there'},</Text>
            <Text style={text}>
              Tired of guessing the exact words you used in that one email?
            </Text>
            <Text style={text}>
              With Mail0's Super Search, you don't have to.
            </Text>
            <Text style={text}>
              You can now search your inbox using plain language. Just type something like:
            </Text>
            <Text style={listItem}>➡️ emails from John</Text>
            <Text style={listItem}>➡️ emails from last week</Text>
            <Text style={listItem}>➡️ unread emails with attachments</Text>
            <Text style={listItem}>➡️ emails about meeting</Text>
            <Text style={listItem}>➡️ emails from last month</Text>
            <Text style={text}>
              No weird syntax or advanced filters. Just write what you're looking for and let the AI handle the rest.
            </Text>
            <Text style={text}>
              It's fast, flexible, and honestly kind of magical.
            </Text>
            <Text style={text}>
              Let's nerd out about how Super Search works.{' '}
              <Link href="https://cal.com/team/0/chat?overlayCalendar=true" style={link}>
                I'll send you a $20 gift card just for booking a time
              </Link>
            </Text>
            <Text style={text}>
              See you in the future,
            </Text>
            <Text style={signature}>Adam</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};
