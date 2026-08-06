export function sortMessagesNewestFirst<T extends { receivedOn: string }>(
  messages: readonly T[],
): T[] {
  return messages
    .map((message, index) => ({
      message,
      index,
      receivedAt: Date.parse(message.receivedOn),
    }))
    .sort((left, right) => {
      const leftTime = Number.isNaN(left.receivedAt) ? Number.NEGATIVE_INFINITY : left.receivedAt;
      const rightTime = Number.isNaN(right.receivedAt)
        ? Number.NEGATIVE_INFINITY
        : right.receivedAt;

      return rightTime - leftTime || left.index - right.index;
    })
    .map(({ message }) => message);
}
