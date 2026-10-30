// A rejected task must not poison the queue or prevent later deliveries.
export function createSerialQueue() {
  let tail = Promise.resolve();
  return task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}
