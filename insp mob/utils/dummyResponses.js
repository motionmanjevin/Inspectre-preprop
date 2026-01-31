// Dummy video search responses
const videoTemplates = [
  {
    title: "Person approaching main entrance",
    location: "Front Gate Camera",
  },
  {
    title: "White sedan entering parking area",
    location: "Parking Area Camera",
  },
  {
    title: "Movement in restricted perimeter",
    location: "Perimeter Camera 3",
  },
  {
    title: "Delivery truck at loading dock",
    location: "Loading Dock Camera",
  },
  {
    title: "Security patrol walkthrough",
    location: "Corridor Camera 2",
  }
];

// Dummy LLM analysis responses
const analysisTemplates = [
  {
    analysis: "I reviewed the footage from this morning and everything appears routine. The maintenance crew arrived on schedule around 7:30 AM and followed standard safety protocols throughout their work. All personnel had proper identification and the activities match what was planned for today's maintenance window.",
  },
  {
    analysis: "There was some unusual activity I noticed around the restricted access area. Someone was moving through that zone outside of normal hours, and I couldn't identify proper credentials from the footage. This might be worth looking into further as it doesn't match the typical patterns I see.",
  },
  {
    analysis: "The morning shift started normally with all authorized personnel checking in as expected. I saw the usual traffic flow patterns with people arriving between 8:00-8:30 AM. The loading dock had scheduled delivery activity that proceeded without any issues.",
  },
  {
    analysis: "I found what you're looking for. There was vehicle activity in the parking area around 2:15 PM - a white sedan entered and parked in the visitor section. The driver appeared to be following normal procedures and the timing aligns with the scheduled appointment log.",
  }
];

// Generate timestamp in the last 24 hours
function generateRecentTimestamp() {
  const now = new Date();
  const hoursAgo = Math.floor(Math.random() * 24);
  const minutesAgo = Math.floor(Math.random() * 60);
  
  const timestamp = new Date(now - (hoursAgo * 60 * 60 * 1000) - (minutesAgo * 60 * 1000));
  
  return timestamp.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// Generate contextual responses based on query
function getContextualResponse(query, templates) {
  const queryLower = query.toLowerCase();
  
  // Try to match query context to appropriate template
  if (queryLower.includes('person') || queryLower.includes('people') || queryLower.includes('individual')) {
    return templates[0];
  } else if (queryLower.includes('car') || queryLower.includes('vehicle') || queryLower.includes('parking')) {
    return templates[1];
  } else if (queryLower.includes('security') || queryLower.includes('restricted') || queryLower.includes('unauthorized')) {
    return templates[2];
  } else if (queryLower.includes('delivery') || queryLower.includes('truck') || queryLower.includes('package')) {
    return templates[3];
  } else if (queryLower.includes('patrol') || queryLower.includes('guard') || queryLower.includes('check')) {
    return templates[4];
  }
  
  // Default to random template
  return templates[Math.floor(Math.random() * templates.length)];
}

export function generateDummyVideoResponse(query) {
  const template = getContextualResponse(query, videoTemplates);
  
  return {
    title: template.title,
    timestamp: generateRecentTimestamp(),
    location: template.location
  };
}

export function generateDummyLLMResponse(query) {
  const template = getContextualResponse(query, analysisTemplates);
  
  return {
    analysis: template.analysis
  };
}