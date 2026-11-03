import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Style IDs from the landmarksweb styles page (190-217)
const STYLE_IDS = Array.from({ length: 28 }, (_, i) => 190 + i);

// Fetch style details from landmarksweb
async function fetchStyleDetails(styleId) {
  try {
    const url = `https://webapps1.chicago.gov/landmarksweb/web/styledetails.htm?styId=${styleId}`;
    const response = await axios.get(url);
    const html = response.data;

    // Parse style name from the page title or heading
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : '';

    // Extract style name (remove "Chicago Landmarks - Style Details" prefix)
    const styleName = title.replace(/Chicago Landmarks - Style Details - /i, '').trim();

    return {
      id: styleId,
      name: styleName,
      url: url
    };
  } catch (error) {
    console.error(`Error fetching style ${styleId}:`, error.message);
    return null;
  }
}

// Fetch all styles and create a mapping
async function main() {
  console.log('Fetching style details from landmarksweb...');

  const styles = [];
  for (const styleId of STYLE_IDS) {
    const style = await fetchStyleDetails(styleId);
    if (style) {
      styles.push(style);
      console.log(`  ✓ ${style.name} (ID: ${styleId})`);
    } else {
      console.log(`  ✗ Failed to fetch style ${styleId}`);
    }
  }

  // Create a mapping for lookup
  const styleMap = styles.reduce((map, style) => {
    map[style.name] = style;
    return map;
  }, {});

  // Save to JSON file
  const outputPath = path.join(process.cwd(), 'src/data/landmarkStyles.json');
  fs.writeFileSync(outputPath, JSON.stringify(styleMap, null, 2));

  console.log(`\n✓ Saved ${styles.length} styles to ${outputPath}`);
}

main().catch(console.error);