// Simple script to hide wishlist prices using multiple methods
(function() {
  'use strict';
  
  // Function to hide prices in wishlist shadow DOM
  const hideWishlistPrices = () => {
    console.log('=== HIDING WISHLIST PRICES IN SHADOW DOM ===');
    
    // DIAGNOSTIC: Let's see what wishlist elements actually exist
    const allWishlistElements = document.querySelectorAll('[class*="ooo"], [id*="wishlist"], ooo-wl-page-content, template[id*="ooo-wl"]');
    console.log(`DIAGNOSTIC: Found ${allWishlistElements.length} total wishlist-related elements:`, allWishlistElements);
    
    // Check specifically for custom elements
    const customElements = document.querySelectorAll('ooo-wl-page-content, ooo-wl-page-shared-content, ooo-wl-page-product-card');
    console.log(`DIAGNOSTIC: Found ${customElements.length} wishlist custom elements:`, customElements);
    
    // Check if ooo-wl-page-content exists and has content
    const pageContent = document.querySelector('ooo-wl-page-content');
    if (pageContent) {
      console.log('DIAGNOSTIC: ooo-wl-page-content found:', pageContent);
      console.log('DIAGNOSTIC: ooo-wl-page-content innerHTML:', pageContent.innerHTML.substring(0, 500));
      console.log('DIAGNOSTIC: ooo-wl-page-content style:', pageContent.style.cssText);
      console.log('DIAGNOSTIC: ooo-wl-page-content hidden attribute:', pageContent.hasAttribute('hidden'));
    } else {
      console.log('DIAGNOSTIC: ooo-wl-page-content NOT FOUND - still waiting for wishlist app to create it');
    }
    
    // Check if the templates are being processed
    const mainTemplate = document.querySelector('template#ooo-wl-page-content');
    if (mainTemplate) {
      console.log('DIAGNOSTIC: Main template exists:', mainTemplate.innerHTML.substring(0, 300));
    }
    
    const productCards = document.querySelectorAll('ooo-wl-page-product-card');
    console.log(`Found ${productCards.length} wishlist product cards`);
    
    let hiddenCount = 0;
    
    productCards.forEach((card, index) => {
      console.log(`Processing product card ${index}:`, card);
      
      if (card.shadowRoot) {
        console.log(`Product card ${index} has Shadow DOM`);
        
        // Method 1: Inject CSS into Shadow DOM
        const existingStyle = card.shadowRoot.querySelector('#hide-price-style');
        if (!existingStyle) {
          const style = document.createElement('style');
          style.id = 'hide-price-style';
          style.textContent = `
            .ooo-wl-page-product-card__price-container,
            .ooo-wl-page-product-card__price,
            [data-field="price-container"],
            [data-field="price"],
            [data-field="compare-at-price"] {
              display: none !important;
              visibility: hidden !important;
              opacity: 0 !important;
              height: 0 !important;
              overflow: hidden !important;
            }
          `;
          // Append to the end to ensure it loads after the app's CSS
          card.shadowRoot.appendChild(style);
          console.log(`Injected CSS into product card ${index} shadow DOM`);
        }
        
        // Method 2: Directly hide elements
        const priceContainers = card.shadowRoot.querySelectorAll('.ooo-wl-page-product-card__price-container, .ooo-wl-page-product-card__price, [data-field="price-container"], [data-field="price"], [data-field="compare-at-price"]');
        
        console.log(`Found ${priceContainers.length} price elements in product card ${index}`);
        
        priceContainers.forEach((container, priceIndex) => {
          console.log(`Hiding price element ${priceIndex} in card ${index}:`, container);
          container.style.setProperty('display', 'none', 'important');
          container.style.setProperty('visibility', 'hidden', 'important');
          container.style.setProperty('opacity', '0', 'important');
          container.style.setProperty('height', '0', 'important');
          container.style.setProperty('overflow', 'hidden', 'important');
          hiddenCount++;
        });
        
        // Method 3: Hide any text content containing price patterns
        const allElements = card.shadowRoot.querySelectorAll('*');
        allElements.forEach(el => {
          const text = el.textContent?.trim();
          if (text && (text.includes('kr') || text.includes('SEK') || text.match(/\d+[,.]?\d*\s*(kr|SEK)/i))) {
            console.log(`Hiding element with price text in card ${index}:`, text, el);
            el.style.setProperty('display', 'none', 'important');
            hiddenCount++;
          }
        });
        
      } else {
        console.log(`Product card ${index} does NOT have Shadow DOM`);
      }
    });
    
    // AGGRESSIVE APPROACH: If no shadow DOM elements found, scan the entire page
    if (hiddenCount === 0) {
      console.log('No shadow DOM prices found, scanning entire page for wishlist prices...');
      
      // Look for ANY elements that might contain prices
      const allElements = document.querySelectorAll('*');
      let scannedCount = 0;
      
      allElements.forEach(el => {
        const text = el.textContent?.trim();
        
        // Check for Swedish price patterns
        if (text && (text.includes('kr SEK') || text.match(/\d+[,.]?\d*\s*(kr|SEK)/i))) {
          scannedCount++;
          
          // Check if this element is in a wishlist context
          const inWishlistBlock = el.closest('[id*="wishlist"]') || 
                                 el.closest('[class*="ooo"]') ||
                                 el.closest('[id*="shopify-block"]');
          
          // Also check if parent elements suggest this is wishlist content
          const parentText = el.parentElement?.className || '';
          const grandParentText = el.parentElement?.parentElement?.className || '';
          
          const likelyWishlist = parentText.includes('ooo') || 
                               grandParentText.includes('ooo') ||
                               inWishlistBlock;
          
          if (likelyWishlist) {
            console.log('🎯 FOUND WISHLIST PRICE! Hiding:', text, el);
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('opacity', '0', 'important');
            hiddenCount++;
            
            // Also hide parent if it's likely a price container
            if (el.parentElement && el.parentElement.children.length <= 2) {
              console.log('Also hiding parent container:', el.parentElement);
              el.parentElement.style.setProperty('display', 'none', 'important');
            }
          }
        }
      });
      
      console.log(`Scanned ${scannedCount} potential price elements`);
      
      // Also try direct selectors
      const directSelectors = [
        '.ooo-wl-page-product-card__price-container',
        '.ooo-wl-page-product-card__price', 
        '[data-field="price-container"]',
        '[data-field="price"]',
        '[data-field="compare-at-price"]'
      ];
      
      directSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            console.log(`🎯 DIRECT MATCH! Found ${elements.length} elements with: ${selector}`);
            elements.forEach(el => {
              console.log('Directly hiding:', el);
              el.style.setProperty('display', 'none', 'important');
              hiddenCount++;
            });
          }
        } catch (e) {
          // Ignore selector errors
        }
      });
    }
    
    console.log(`=== HIDDEN ${hiddenCount} PRICE ELEMENTS IN SHADOW DOM ===`);
    return hiddenCount;
  };
  
  // Function to inject global CSS as backup
  const injectGlobalCSS = () => {
    if (document.getElementById('wishlist-price-hider-global')) return;
    
    const style = document.createElement('style');
    style.id = 'wishlist-price-hider-global';
    style.textContent = `
      /* Global backup CSS - might not work for Shadow DOM but good fallback */
      ooo-wl-page-product-card,
      .ooo-wl-page-product-card__price-container,
      .ooo-wl-page-product-card__price,
      [class*="ooo-wl"] [data-field="price"],
      [class*="ooo-wl"] [data-field="price-container"] {
        --price-display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  // Function to monitor custom elements registration
  const monitorCustomElementsRegistration = () => {
    console.log('=== MONITORING CUSTOM ELEMENTS REGISTRATION ===');
    
    // Override customElements.define to catch when wishlist components get registered
    const originalDefine = window.customElements.define;
    window.customElements.define = function(name, constructor, options) {
      console.log(`Custom element defined: ${name}`);
      
      if (name.includes('ooo-wl')) {
        console.log(`Wishlist custom element registered: ${name}`);
        
        // Wait a bit for the element to be created, then start monitoring
        setTimeout(() => {
          console.log(`Checking for ${name} elements...`);
          const elements = document.querySelectorAll(name);
          console.log(`Found ${elements.length} ${name} elements`);
          
          if (elements.length > 0) {
            hideWishlistPrices();
          }
        }, 100);
        
        setTimeout(() => hideWishlistPrices(), 500);
        setTimeout(() => hideWishlistPrices(), 1000);
      }
      
      return originalDefine.call(this, name, constructor, options);
    };
  };
  
  // Simple function to inject comprehensive CSS
  const injectComprehensiveCSS = () => {
    if (document.getElementById('comprehensive-wishlist-price-hider')) return;
    
    const style = document.createElement('style');
    style.id = 'comprehensive-wishlist-price-hider';
    style.textContent = `
      /* Hide all possible price elements in wishlist context */
      .ooo-wl-page-product-card__price-container,
      .ooo-wl-page-product-card__price,
      [data-field="price-container"],
      [data-field="price"],
      [data-field="compare-at-price"],
      [class*="ooo-wl"] .price,
      [class*="ooo-wl"] .money,
      [class*="ooo-wl"] [class*="price"],
      [id*="wishlist"] .price,
      [id*="wishlist"] .money,
      [id*="wishlist"] [class*="price"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
      }
      
      /* Target any text that looks like Swedish prices */
      [class*="ooo-wl"] *:contains("kr"),
      [class*="ooo-wl"] *:contains("SEK"),
      [id*="wishlist"] *:contains("kr"),
      [id*="wishlist"] *:contains("SEK") {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
    console.log('Injected comprehensive wishlist price hiding CSS');
  };





  // Watch for script tags being added (wishlist app injection)
  const watchForWishlistScript = () => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          // Check if it's a script tag with wishlist-related content
          if (node.nodeType === 1) {
            if (node.tagName === 'SCRIPT' && 
                (node.src?.includes('wishlist') || 
                 node.textContent?.includes('ooo') || 
                 node.textContent?.includes('wishlist'))) {
              console.log('Wishlist script detected, hiding prices...');
              setTimeout(hideWishlistPrices, 100);
              setTimeout(hideWishlistPrices, 500);
              setTimeout(hideWishlistPrices, 1000);
            }
            
            // Check if wishlist content was added
            if (node.classList?.toString().includes('ooo-wl') ||
                node.querySelector?.('[class*="ooo-wl"]') ||
                node.classList?.contains('shopify-app-block') ||
                node.id?.includes('wishlist')) {
              console.log('Wishlist content detected, hiding prices...');
              setTimeout(hideWishlistPrices, 50);
              setTimeout(hideWishlistPrices, 200);
            }
            
            // CRITICAL: Watch for custom element instantiation
            if (node.tagName === 'OOO-WL-PAGE-PRODUCT-CARD') {
              console.log('Wishlist product card instantiated!', node.tagName, node.className);
              // Hide prices immediately and repeatedly
              setTimeout(() => hideWishlistPrices(), 10);
              setTimeout(() => hideWishlistPrices(), 50);
              setTimeout(() => hideWishlistPrices(), 100);
              setTimeout(() => hideWishlistPrices(), 200);
              setTimeout(() => hideWishlistPrices(), 500);
            }
          }
        });
        
        // CRITICAL: Watch for any changes to ooo-wl-page-content
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          
          // Monitor ooo-wl-page-content visibility changes
          if (target.tagName === 'OOO-WL-PAGE-CONTENT') {
            console.log('OOO-WL-PAGE-CONTENT attribute changed:', mutation.attributeName, target);
            console.log('Current style:', target.style.cssText);
            console.log('Hidden attribute:', target.hasAttribute('hidden'));
            
            // If it becomes visible, start aggressive monitoring
            if (!target.hasAttribute('hidden') || target.style.display !== 'none') {
              console.log('Wishlist content became visible! Starting aggressive monitoring...');
              for (let i = 0; i < 10; i++) {
                setTimeout(() => hideWishlistPrices(), i * 100);
              }
            }
          }
          
          // If it's a product card, check for shadow DOM updates
          if (target.tagName === 'OOO-WL-PAGE-PRODUCT-CARD') {
            console.log('Product card attribute changed, checking shadow DOM...');
            setTimeout(() => hideWishlistPrices(), 50);
          }
        }
        
        // Watch for shadow DOM content changes and innerHTML updates
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              // Product card added
              if (node.tagName === 'OOO-WL-PAGE-PRODUCT-CARD') {
                console.log('Product card added to DOM!');
                setTimeout(() => hideWishlistPrices(), 10);
                setTimeout(() => hideWishlistPrices(), 100);
                setTimeout(() => hideWishlistPrices(), 500);
              }
              
              // Check if any element was added inside ooo-wl-page-content
              if (node.closest && node.closest('ooo-wl-page-content')) {
                console.log('Content added inside ooo-wl-page-content:', node);
                setTimeout(() => hideWishlistPrices(), 50);
              }
              
              // Check if the node contains product cards
              if (node.querySelector && node.querySelector('ooo-wl-page-product-card')) {
                console.log('Element with product cards added!', node);
                setTimeout(() => hideWishlistPrices(), 50);
              }
            }
          });
        }
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'data-field'],
      characterData: true,
      characterDataOldValue: true
    });
    
    return observer;
  };

  // Simplified initialization
  const initialize = () => {
    console.log('Initializing SIMPLE wishlist price hiding script...');
    
    // Inject comprehensive CSS immediately
    injectGlobalCSS();
    injectComprehensiveCSS();
    
    // Start monitoring custom elements
    monitorCustomElementsRegistration();
    
    // Start watching for DOM changes
    const observer = watchForWishlistScript();
    
    // Run hide attempts at regular intervals
    const runHideAttempts = () => {
      hideWishlistPrices();
      setTimeout(runHideAttempts, 1000); // Every second
    };
    
    // Start immediately
    setTimeout(() => {
      console.log('Starting regular hide attempts...');
      runHideAttempts();
    }, 100);
    
    // Also run on key events
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOM loaded, hiding prices');
      hideWishlistPrices();
    });
    
    window.addEventListener('load', () => {
      console.log('Window loaded, hiding prices');
      hideWishlistPrices();
    });
    
    // Watch for wishlist global object
    const checkGlobal = setInterval(() => {
      if (window.ooo?.wishlist) {
        console.log('Wishlist global detected, hiding prices');
        hideWishlistPrices();
        clearInterval(checkGlobal);
      }
    }, 500);
    
    // Clean up after 2 minutes
    setTimeout(() => {
      observer.disconnect();
      console.log('Cleanup completed');
    }, 120000);
  };
  
  // Start the script
  initialize();

})();

// Additional logging for debugging
console.log('Lightweight wishlist price hiding script loaded and running...');