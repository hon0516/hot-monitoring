export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const randomDelay = () => {
  const seconds = 5 + Math.floor(Math.random() * 6);
  return seconds * 1000;
};

