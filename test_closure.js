function render() {
  const handler = () => {
    console.log("myVar is:", myVar);
  };
  const myVar = 42;
  return handler;
}
render()();
