/* START APPLICATION */
async function start() {
  token = tokenInput.value.trim();
  if (!token) return alert("Token required");

  login.style.display = "none";
  app.style.display = "block";

  buildLocationPicker();
  await load();
}
