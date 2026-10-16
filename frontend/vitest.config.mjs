// Socket mocks must not leak into another spec through shared Angular modules.
// One worker also keeps component compilation reliable on small build machines.
export default {
  test: {
    isolate: true,
    maxWorkers: 1,
    fileParallelism: false
  }
};
