import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { m } from '@/paraglide/messages';

const formSchema = z.object({
  email: z.string().email({ message: m['pages.auth.validEmail']() }),
  password: z.string().min(6, { message: m['pages.auth.minimumPassword']({ count: 6 }) }),
});

export default function LoginZero() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    // Use the correct sonner toast API
    toast.success(m['pages.auth.loginAttempt']({ email: values.email }), {
      description: m['pages.auth.loginAttemptDescription'](),
    });

    // Here you would typically handle authentication
  }

  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center bg-black">
      <div className="animate-in slide-in-from-bottom-4 w-full max-w-md px-6 py-8 duration-500">
        <div className="mb-4 text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">{m['pages.auth.loginTitle']()}</h1>
          <p className="text-muted-foreground">{m['pages.auth.loginDescription']()}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground">{m['pages.auth.email']()}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={m['pages.auth.emailPlaceholder']()}
                      {...field}
                      className="bg-black text-sm text-white placeholder:text-sm"
                    />
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
                    <Link
                      to="/forgot-password"
                      className="text-muted-foreground text-xs hover:text-white"
                    >
                      {m['pages.auth.forgotPassword']()}
                    </Link>
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
              {m['pages.auth.login']()}
            </Button>

            <div className="mt-6 text-center text-sm">
              <p className="text-muted-foreground">
                {m['pages.auth.noAccount']()}{' '}
                <a href="/zero/signup" className="text-white underline hover:text-white/80">
                  {m['pages.auth.signUp']()}
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
