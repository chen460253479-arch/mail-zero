import { describe, expect, it } from 'vitest';

import { ensurePubSubPublisher } from './pubsub-policy';

describe('Gmail Pub/Sub IAM policy', () => {
  it('adds the Gmail publisher once and preserves unrelated bindings', () => {
    const initial = {
      bindings: [
        { role: 'roles/viewer', members: ['user:viewer@example.test'] },
        {
          role: 'roles/pubsub.publisher',
          members: ['serviceAccount:gmail-api-push@system.gserviceaccount.com'],
        },
      ],
    };

    const once = ensurePubSubPublisher(
      initial,
      'serviceAccount:gmail-api-push@system.gserviceaccount.com',
    );
    const twice = ensurePubSubPublisher(
      once,
      'serviceAccount:gmail-api-push@system.gserviceaccount.com',
    );

    expect(twice).toEqual(initial);
    expect(twice.bindings?.filter(({ role }) => role === 'roles/pubsub.publisher')).toHaveLength(1);
  });
});
