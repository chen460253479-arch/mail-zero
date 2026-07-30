import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { m } from '@/paraglide/messages';

const formSchema = z.object({
  name: z.string().min(1, { message: m['pages.auth.minimumName']({ count: 1 }) }),
  email: z.string().min(1, { message: m['pages.auth.minimumUsername']({ count: 1 }) }),
  password: z.string().min(6, { message: m['pages.auth.minimumPassword']({ count: 6 }) }),
});

export default function SignupZero() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    // Append the @0.email suffix to the username
    const fullEmail = `${values.email}@0.email`;

    // Use the correct sonner toast API
    toast.success(m['pages.auth.signupAttempt']({ email: fullEmail }), {
      description: m['pages.auth.signupAttemptDescription'](),
    });

    // Here you would typically handle authentication with the full email
  }

  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center bg-black">
      <div className="animate-in slide-in-from-bottom-4 w-full max-w-md px-6 py-8 duration-500">
        <div className="mb-4 text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">{m['pages.auth.signupTitle']()}</h1>
          <p className="text-muted-foreground">{m['pages.auth.signupDescription']()}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mx-auto space-y-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground">{m['pages.auth.name']()}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={m['pages.auth.namePlaceholder']()}
                      {...field}
                      className="bg-black text-sm text-white placeholder:text-sm"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground">{m['pages.auth.email']()}</FormLabel>
                  <FormControl>
                    <div className="relative w-full rounded-md">
                      <Input
                        placeholder={m['pages.auth.usernamePlaceholder']()}
                        {...field}
                        className="w-full bg-black pr-16 text-sm text-white placeholder:text-sm"
                      />
                      <span className="bg-popover text-muted-foreground border-input absolute bottom-0 right-0 top-0 flex items-center rounded-r-md border border-l-0 px-3 py-2 text-sm">
                        @0.email
                      </span>
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-muted-foreground">
                      {m['pages.auth.password']()}
                    </FormLabel>
                  </div>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      {...field}
                      className="bg-black text-white"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full">
              {m['pages.auth.signup']()}
            </Button>

            <div className="mt-6 text-center text-sm">
              <p className="text-muted-foreground">
                {m['pages.auth.haveAccount']()}{' '}
                <a href="/zero/login" className="text-white underline hover:text-white/80">
                  {m['pages.auth.login']()}
                </a>
              </p>
            </div>
          </form>
        </Form>
      </div>

      <footer className="absolute bottom-0 w-full px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-6">
          <a
            href="/terms"
            className="text-[10px] text-gray-500 transition-colors hover:text-gray-300"
          >
            {m['pages.auth.terms']()}
          </a>
        </div>
      </footer>
    </div>
  );
}
