import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsCard } from '@/components/settings/settings-card';
import { zodResolver } from '@hookform/resolvers/zod';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useForm } from 'react-hook-form';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { m } from '@/paraglide/messages';
import * as z from 'zod';

const formSchema = z.object({
  newMailNotifications: z.enum(['none', 'important', 'all']),
  marketingCommunications: z.boolean(),
});

export default function NotificationsPage() {
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      newMailNotifications: 'all',
      marketingCommunications: false,
    },
  });

  function onSubmit() {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
    }, 1000);
  }

  return (
    <div className="grid gap-6">
      <SettingsCard
        title={m['pages.settings.notifications.title']()}
        description={m['pages.settings.notifications.description']()}
        footer={
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => form.reset()}>
              {m['common.actions.resetToDefaults']()}
            </Button>
            <Button type="submit" form="notifications-form" disabled={isSaving}>
              {isSaving ? m['common.actions.saving']() : m['common.actions.saveChanges']()}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <form
            id="notifications-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="newMailNotifications"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{m['pages.settings.notifications.newMail']()}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-[240px]">
                        <Bell className="mr-2 h-4 w-4" />
                        <SelectValue placeholder={m['pages.settings.notifications.selectLevel']()} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">{m['pages.settings.notifications.none']()}</SelectItem>
                      <SelectItem value="important">
                        {m['pages.settings.notifications.importantOnly']()}
                      </SelectItem>
                      <SelectItem value="all">{m['pages.settings.notifications.allMessages']()}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {m['pages.settings.notifications.newMailDescription']()}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="marketingCommunications"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      {m['pages.settings.notifications.marketing']()}
                    </FormLabel>
                    <FormDescription>
                      {m['pages.settings.notifications.marketingDescription']()}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
      </SettingsCard>
    </div>
  );
}
