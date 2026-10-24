const fs = require('fs');

let apiContent = fs.readFileSync('src/lib/api.ts', 'utf8');

// Fix fetchBnrRates
apiContent = apiContent.replace(
  "  const data = await res.json();\n  const remappedData: Record<string, any> = {};\n  for (const [key, val] of Object.entries(data)) {\n    remappedData[key] = val;\n    if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;\n  }\n  return remappedData;\n}",
  "  return res.json();\n}"
);

// Fix fetchQuotes
apiContent = apiContent.replace(
  "  if (!res.ok) {\n    console.error('Failed to fetch quotes');\n    return {};\n  }\n  return res.json();\n}",
  "  if (!res.ok) {\n    console.error('Failed to fetch quotes');\n    return {};\n  }\n  const data = await res.json();\n  const remappedData: Record<string, any> = {};\n  for (const [key, val] of Object.entries(data)) {\n    remappedData[key] = val;\n    if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;\n  }\n  return remappedData;\n}"
);

fs.writeFileSync('src/lib/api.ts', apiContent);
