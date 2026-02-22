export const tools = [
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "Navigate the browser to a specific URL. Use this to open websites. Waits for page to fully load including dynamic content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL including https://" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_page_elements",
      description: "Extract ALL interactive elements from the current page including buttons, inputs, links, videos, headings, cards, and clickable divs. This tool now detects elements in shadow DOM, handles dynamic content, and finds elements even if they're below the fold. Always call this after navigating or scrolling to see what's available. Returns detailed info including text, aria-labels, and whether element is clickable.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Smart click that handles overlays, scrolls element into view, and tries multiple click methods. Can click elements even if they're covered by popups or modals. Use the exact selector from get_page_elements output.",
      parameters: {
        type: "object",
        properties: {
          selector: { 
            type: "string", 
            description: "CSS selector from get_page_elements. Can also use format like button:has-text('Skip Ad') for text-based selection." 
          }
        },
        required: ["selector"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text into an input field. Automatically clears existing content first.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the input field from get_page_elements" },
          text: { type: "string", description: "Text to type" }
        },
        required: ["selector", "text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "press_enter",
      description: "Press the Enter key (useful for submitting forms or search queries).",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_page_content",
      description: "Get the visible text content of the current page. Use this to read what's on the page when get_page_elements doesn't show enough info.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_markdown",
      description: "Get clean markdown content from a URL without opening browser. Use for reading articles/documentation when you don't need to interact with the page. This is faster than navigate_to + get_page_content for pure reading tasks.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait_for_element",
      description: "Wait for a specific element to appear on the page. Useful for dynamic content that loads after page navigation. Use this when you expect an element to appear but it's not immediately visible.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to wait for" },
          timeout: { type: "number", description: "Timeout in milliseconds (default: 10000)" }
        },
        required: ["selector"]
      }
    }
  }
]; 