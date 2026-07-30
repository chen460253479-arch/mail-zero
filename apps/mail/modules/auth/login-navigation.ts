export const enterMailboxAfterLogin = (location: Pick<Location, 'assign'> = window.location) => {
  location.assign('/mail/inbox');
};
