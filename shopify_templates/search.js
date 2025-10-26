/**
 * PredictiveSearch - Enhanced with Swedish Character Normalization
 * 
 * This search component automatically handles Swedish characters (å, ä, ö) 
 * by normalizing them to ASCII equivalents (a, a, o) for better search results.
 * This allows users to find products regardless of whether they type "Limträ" or "Limtra".
 * 
 * Features:
 * - Automatic normalization of Swedish characters å, ä, ö to a, a, o
 * - Works with Shopify's predictive search API
 * - SKU search with character normalization
 * - Handles multi-word queries properly
 * - Avoids URL encoding issues with complex search operators
 */
class PredictiveSearch extends HTMLElement {
  constructor() {
    super();
    this.cachedMap = new Map();
    this.focusElement = this.input;
    this.resetButton.addEventListener('click', this.clear.bind(this));
    this.input.addEventListener('input', FoxTheme.utils.debounce(this.onChange.bind(this), 300));
    this.input.addEventListener('focus', this.onFocus.bind(this));
    this.searchContent = this.querySelector('.search__content');
    this.searchRecommendationEmpty = this.dataset.searchRecommendationEmpty === 'true';
    this.header = document.querySelector('header');

    this.boundHandleClickOutside = this.handleClickOutside.bind(this);
    document.addEventListener('click', this.boundHandleClickOutside);
    this.searchProductTypes?.addEventListener('change', this.handleProductTypeChange.bind(this));

    this.isHeaderSearch = this.closest('header') !== null;

    document.addEventListener('menu-drawer:open', () => {
      this.classList.remove('predictive-search-open');
      document.body.classList.remove('search-open');
    });

    this.states = {
      OPEN: 'predictive-search-open',
      LOADING: 'btn--loading',
      SEARCH_OPEN: 'search-open',
    };
  }

  // Normalize search query to handle Swedish characters
  normalizeSwedishChars(str) {
    const charMap = {
      'å': 'a', 'ä': 'a', 'ö': 'o',
      'Å': 'A', 'Ä': 'A', 'Ö': 'O'
    };
    
    return str.replace(/[åäöÅÄÖ]/g, match => charMap[match] || match);
  }

  // Create search terms - use normalized version when Swedish characters detected
  createSearchTerms(query) {
    const original = query.trim();
    const normalized = this.normalizeSwedishChars(original);
    
    // If query contains Swedish characters, use normalized version for better results
    if (original !== normalized) {
      console.log(`Swedish chars detected: "${original}" -> searching with "${normalized}"`);
      return normalized;
    }
    
    return original;
  }

  get input() {
    return this.querySelector('input[type="search"]');
  }
  get resetButton() {
    return this.querySelector('button[type="reset"]');
  }

  get searchProductTypes() {
    return this.querySelector('#SearchProductTypes');
  }

  onFocus(event) {
    document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
    document.documentElement.style.setProperty(
      '--header-bottom-position',
      `${parseInt(this.header.getBoundingClientRect().bottom)}px`
    );
    if (this.isHeaderSearch && !this.searchRecommendationEmpty) {
      document.body.classList.add('search-open');
    }

    if (!this.searchRecommendationEmpty) {
      this.searchContent.classList.remove('hidden');
    }

    this.classList.add('predictive-search-open');
    if (this.getQuery().length === 0) {
      return;
    }
    const url = this.setupURL().toString();
    this.renderSection(url, event);
  }

  getQuery() {
    return this.input.value.trim();
  }

  isPotentialSku(query) {
    // Check if query looks like a SKU
    // For this shop, SKUs are just numbers like 1002450008
    const skuPattern = /^\d+$/;
    
    // Consider it a potential SKU if:
    // 1. Contains only digits
    // 2. Is between 5 and 15 characters (reasonable range for numeric SKUs)
    return query.length >= 5 && 
           query.length <= 15 && 
           skuPattern.test(query);
  }

  clear(event = null) {
    event?.preventDefault();
    this.input.value = '';
    this.input.focus();
    this.removeAttribute('results');
    this.toggleSearchState(false);
  }

  handleProductTypeChange(evt) {
    const query = this.getQuery();
    if (query.length > 0) {
      const url = this.setupURL().toString();
      this.renderSection(url);
    }
  }

  setupURL() {
    const url = new URL(`${FoxTheme.routes.shop_url}${FoxTheme.routes.predictive_search_url}`);
    let search_term = this.createSearchTerms(this.getQuery());
    
    if (this.searchProductTypes && this.searchProductTypes.value != '') {
      search_term = `product_type:${this.searchProductTypes.value} AND (${encodeURIComponent(search_term)})`;
    } else {
      search_term = encodeURIComponent(search_term);
    }
    
    url.searchParams.set('q', search_term);
    url.searchParams.set('resources[limit]', this.dataset.resultsLimit || 3);
    url.searchParams.set('resources[limit_scope]', 'each');
    url.searchParams.set('section_id', FoxTheme.utils.getSectionId(this));
    
    return url;
  }

  onChange() {
    if (this.getQuery().length === 0) {
      this.clear();
      return;
    }
    
    // If it's a potential SKU, try SKU-specific search
    if (this.isPotentialSku(this.getQuery())) {
      this.handleSkuSearch();
    } else {
      const url = this.setupURL().toString();
      this.renderSection(url);
    }
  }

  async handleSkuSearch() {
    this.setLoadingState(true);
    
    try {
      // Since predictive search doesn't support SKU, use regular search API
      const products = await this.searchProductsBySku(this.getQuery());
      
      if (products && products.length > 0) {
        // Create and render custom SKU results
        this.renderCustomSkuResults(products);
        this.setLoadingState(false);
        this.setAttribute('results', 'true');
      } else {
        // If no SKU results found, fall back to regular predictive search
        const regularUrl = this.setupURL().toString();
        this.renderSection(regularUrl);
      }
    } catch (error) {
      console.error('Error in SKU search:', error);
      // Fall back to regular predictive search
      const regularUrl = this.setupURL().toString();
      this.renderSection(regularUrl);
    }
  }

  async searchProductsBySku(sku) {
    try {
      // Try multiple search strategies to find the product by SKU
      // Also try with normalized Swedish characters for SKU-like searches
      const normalizedSku = this.normalizeSwedishChars(sku);
      const searchQueries = sku !== normalizedSku ? [sku, normalizedSku] : [sku];
      
      for (const searchSku of searchQueries) {
        // Strategy 1: Try sku: prefix
        let searchUrl = new URL('/search', window.location.origin);
        searchUrl.searchParams.set('q', `sku:${searchSku}`);
        searchUrl.searchParams.set('type', 'product');
        searchUrl.searchParams.set('options[prefix]', 'last');
        
        console.log('Fetching SKU from regular search (strategy 1 - sku:):', searchUrl.toString());
        
        let response = await fetch(searchUrl.toString());
        if (response.ok) {
          let html = await response.text();
          let products = this.extractProductsFromSearchPage(html, 'sku: prefix');
          if (products && products.length > 0) {
            return products;
          }
        }
        
        // Strategy 2: Try without sku: prefix (just the SKU number)
        searchUrl = new URL('/search', window.location.origin);
        searchUrl.searchParams.set('q', searchSku);
        searchUrl.searchParams.set('type', 'product');
        searchUrl.searchParams.set('options[prefix]', 'last');
        
        console.log('Fetching SKU from regular search (strategy 2 - plain SKU):', searchUrl.toString());
        
        response = await fetch(searchUrl.toString());
        if (response.ok) {
          let html = await response.text();
          let products = this.extractProductsFromSearchPage(html, 'plain SKU');
          if (products && products.length > 0) {
            return products;
          }
        }
        
        // Strategy 3: Try with variant_sku: prefix
        searchUrl = new URL('/search', window.location.origin);
        searchUrl.searchParams.set('q', `variant_sku:${searchSku}`);
        searchUrl.searchParams.set('type', 'product');
        searchUrl.searchParams.set('options[prefix]', 'last');
        
        console.log('Fetching SKU from regular search (strategy 3 - variant_sku:):', searchUrl.toString());
        
        response = await fetch(searchUrl.toString());
        if (response.ok) {
          let html = await response.text();
          let products = this.extractProductsFromSearchPage(html, 'variant_sku: prefix');
          if (products && products.length > 0) {
            return products;
          }
        }
      }
      
      console.log('No products found with any SKU search strategy');
      return null;
      
    } catch (error) {
      console.error('Error fetching products by SKU:', error);
      return null;
    }
  }

  extractProductsFromSearchPage(html, strategy = 'default') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Debug: log the page title and some content to see what we're getting
      const pageTitle = doc.querySelector('title')?.textContent || 'No title found';
      console.log(`Search page title (${strategy}):`, pageTitle);
      
      // Check if the page actually has search results
      const mainContent = doc.querySelector('main, #main, .main, .content, .search-results');
      if (mainContent) {
        console.log('Main content found, HTML snippet:', mainContent.innerHTML.substring(0, 500));
      } else {
        console.log('No main content found, full body HTML:', doc.body.innerHTML.substring(0, 1000));
      }
      
      // Look for any product links first to see if products exist at all
      const allProductLinks = doc.querySelectorAll('a[href*="/products/"]');
      console.log(`Found ${allProductLinks.length} product links in total`);
      
      if (allProductLinks.length > 0) {
        console.log('First few product links:', Array.from(allProductLinks).slice(0, 3).map(link => ({
          href: link.href,
          text: link.textContent.trim().substring(0, 50),
          parentClass: link.parentElement?.className || 'no class'
        })));
      }
      
      // Look for products in the search results with more comprehensive selectors
      const productSelectors = [
        '.product-item',
        '.card-product',
        '[data-product-id]',
        '.product-card',
        '.grid-product',
        '.search-result-product',
        '.product',
        '.product-wrap',
        '.product-block',
        'article[data-product]',
        '[data-product-handle]',
        '.js-product-item',
        // Add some more generic selectors
        'li[data-product]',
        '.grid-item',
        '.collection-product',
        '.product-tile'
      ];
      
      let productElements = doc.querySelectorAll(productSelectors.join(','));
      
      // If no products found with specific selectors, try broader approach
      if (productElements.length === 0) {
        // Look for any element containing a product link
        const allElements = doc.querySelectorAll('*');
        productElements = Array.from(allElements).filter(el => 
          el.querySelector && el.querySelector('a[href*="/products/"]')
        );
        console.log('Using fallback method, found elements with product links:', productElements.length);
      }
      
      console.log(`Found ${productElements.length} product elements in search results`);
      
      const products = [];
      
      for (let i = 0; i < Math.min(productElements.length, 3); i++) {
        const element = productElements[i];
        const product = this.extractProductData(element);
        if (product) {
          products.push(product);
        }
      }
      
      console.log(`Extracted ${products.length} products:`, products);
      return products;
      
    } catch (error) {
      console.error('Error extracting products from search page:', error);
      return null;
    }
  }

  extractProductData(element) {
    try {
      // Extract product data from the DOM element
      const link = element.querySelector('a[href*="/products/"]');
      
      const titleSelectors = [
        '.product-title',
        '.card-product__title',
        'h3',
        'h2',
        'h1',
        '.product-name',
        '.title',
        '[data-product-title]'
      ];
      
      let title = null;
      for (const selector of titleSelectors) {
        title = element.querySelector(selector);
        if (title && title.textContent.trim()) break;
      }
      
      // If no title found, try getting it from the link text or alt attribute
      if (!title && link) {
        const linkText = link.textContent.trim();
        if (linkText) {
          title = { textContent: linkText };
        }
      }
      
      const image = element.querySelector('img');
      
      const priceSelectors = [
        '.price',
        '.product-price',
        '.money',
        '[data-price]',
        '.price-item',
        '.amount'
      ];
      
      let price = null;
      for (const selector of priceSelectors) {
        price = element.querySelector(selector);
        if (price && price.textContent.trim()) break;
      }
      
      if (!link || !title) {
        console.log('Missing required elements:', { 
          hasLink: !!link, 
          hasTitle: !!title,
          elementHTML: element.outerHTML.substring(0, 200)
        });
        return null;
      }
      
      const productData = {
        url: link.href,
        title: title.textContent.trim(),
        image: image ? image.src : null,
        imageAlt: image ? image.alt || '' : '',
        price: price ? price.textContent.trim() : ''
      };
      
      console.log('Extracted product data:', productData);
      return productData;
      
    } catch (error) {
      console.error('Error extracting product data:', error);
      return null;
    }
  }

  renderCustomSkuResults(products) {
    const targetElement = document.getElementById(`PredictiveSearchResults-${FoxTheme.utils.getSectionId(this)}`);
    
    if (!targetElement) {
      console.error('Target element not found for SKU results');
      return;
    }
    
    // Create HTML for SKU search results that matches the exact predictive search format
    const productsHtml = products.map(product => `
      <div class="product-card product-card-style-card color-scheme-6">
        <div class="product-card__wrapper h-full">
          <div class="product-card__image-wrapper product-card__image-wrapper--main-only color-scheme-1 bg-none">
            <a href="${product.url}" aria-label="${product.title}" tabindex="-1">
              <motion-element data-motion="zoom-out-sm" class="block" style="transform: scale(1);">
                <div class="media-wrapper product-card__image product-card__image--main loaded" style="--aspect-ratio: 1.0">
                  ${product.image ? `
                    <img src="${product.image}" alt="${product.imageAlt}" loading="lazy" fetchpriority="low" class="motion-reduce loaded" sizes="450px">
                  ` : ''}
                </div>
              </motion-element>
            </a>
            <div class="product-card__actions product-card__main-actions">
              <a href="${product.url}" class="product-card__atc product-card__action-button btn btn--white">
                <div class="btn__text flex gap-1 items-center">
                  <span class="product-card__atc-icon product-card__action-icon inline-flex md:hidden">
                    <svg viewBox="0 0 20 20" fill="none" class="icon icon-shopping-bag icon--medium icon--thick" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6.875 18.125C7.56536 18.125 8.125 17.5654 8.125 16.875C8.125 16.1846 7.56536 15.625 6.875 15.625C6.18464 15.625 5.625 16.1846 5.625 16.875C5.625 17.5654 6.18464 18.125 6.875 18.125Z" fill="currentColor"></path>
                      <path d="M15 18.125C15.6904 18.125 16.25 17.5654 16.25 16.875C16.25 16.1846 15.6904 15.625 15 15.625C14.3096 15.625 13.75 16.1846 13.75 16.875C13.75 17.5654 14.3096 18.125 15 18.125Z" fill="currentColor"></path>
                      <path d="M1.25 2.5H3.125L5.99609 12.8344C6.06916 13.0976 6.22643 13.3296 6.44384 13.4949C6.66126 13.6603 6.92685 13.7499 7.2 13.75H14.9219C15.1952 13.7501 15.4609 13.6605 15.6785 13.4952C15.8961 13.3298 16.0535 13.0977 16.1266 12.8344L18.125 5.625H3.99297" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                  </span>
                  <span class="product-card__atc-text product-card__action-text">Se</span>
                </div>
              </a>
            </div>
          </div>
          <div class="product-card__info text-left">
            <h3 class="product-card__title text-pcard-title">
              <a class="reversed-link block" href="${product.url}">
                <span class="reversed-link__text">${product.title}</span>
              </a>
            </h3>
            ${product.price ? `<div class="product-card__price">${product.price}</div>` : ''}
          </div>
          <div class="product-card__list-actions hidden gap-3 flex-col">
            <div class="product-card__list-actions-main">
              <a href="${product.url}" class="product-card__list-atc btn btn--primary">
                <span class="btn__text flex gap-1 items-center">Se</span>
              </a>
            </div>
            <a href="${product.url}" class="btn btn--secondary">
              <span class="btn__text flex gap-1 items-center">Visa detaljer</span>
            </a>
          </div>
        </div>
      </div>
    `).join('');
    
    const skuResultsHtml = `
      <div class="flex w-full flex-col gap-y-6 md:flex-row">
        <div class="flex flex-col flex-grow search__box-products order-last md:order-first">
          <div class="flex flex-col gap-5 lg:gap-6 predictive-search-result search__box-item predictive-search-result--products">
            <h4 class="h4 predictive-search-result__heading">Relaterade produkter</h4>
            <div class="swipe-mobile swipe-mobile--2-cols">
              <div id="predictive-search-results-products-list" class="f-grid gap-3 lg:gap-7d5 swipe-mobile__inner">
                ${productsHtml}
              </div>
            </div>
            <div class="search__results-all block">
              <button type="submit" class="btn btn--primary" form="PredictiveSearch-${FoxTheme.utils.getSectionId(this)}">
                <span class="btn__text flex items-center gap-2">
                  Sök efter "${this.getQuery()}"
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    this.searchContent?.classList.remove('hidden');
    targetElement.innerHTML = skuResultsHtml;
    
    if (this.isHeaderSearch && !document.body.classList.contains('search-open')) {
      document.body.classList.add('search-open');
      this.classList.add('predictive-search-open');
    }
    
    console.log('Rendered custom SKU results for', products.length, 'products');
  }



  renderSection(url) {
    this.cachedMap.has(url) ? this.renderSectionFromCache(url) : this.renderSectionFromFetch(url);
  }

  renderSectionFromCache(url) {
    const responseText = this.cachedMap.get(url);
    this.renderSearchResults(responseText);
    this.setAttribute('results', '');
  }

  renderSectionFromFetch(url) {
    this.setLoadingState(true);

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.text();
      })
      .then((responseText) => {
        this.renderSearchResults(responseText);
        this.cachedMap.set(url, responseText);
      })
      .catch((error) => {
        console.error('Error fetching data: ', error);
        this.setAttribute('error', 'Failed to load data');
      })
      .finally(() => this.setLoadingState(false));
  }
  renderSearchResults(responseText) {
    const id = 'PredictiveSearchResults-' + FoxTheme.utils.getSectionId(this);
    const targetElement = document.getElementById(id);

    if (targetElement) {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(responseText, 'text/html');
      const contentElement = parsedDoc.getElementById(id);

      if (contentElement) {
        this.searchContent?.classList.remove('hidden');
        targetElement.innerHTML = contentElement.innerHTML;

        if (this.isHeaderSearch && !document.body.classList.contains('search-open')) {
          document.body.classList.add('search-open');
          this.classList.add('predictive-search-open');
        }
      } else {
        console.error(`Element with id '${id}' not found in the parsed response.`);
      }
    } else {
      console.error(`Element with id '${id}' not found in the document.`);
    }
  }

  handleClickOutside(event) {
    const target = event.target;
    const shouldClose = this.isHeaderSearch
      ? !this.contains(target) &&
        ((target.classList.contains('fixed-overlay') && target.closest('.header-section')) ||
          target.classList.contains('header__search-close'))
      : !this.contains(target);

    if (shouldClose) {
      setTimeout(() => this.toggleSearchState(false));
    }
  }

  toggleSearchState(isOpen) {
    this.classList.toggle(this.states.OPEN, isOpen);
    if (this.isHeaderSearch) {
      document.body.classList.toggle(this.states.SEARCH_OPEN, isOpen);
    }
    if (!isOpen && this.searchRecommendationEmpty) {
      this.searchContent?.classList.add('hidden');
    }
  }

  setLoadingState(isLoading) {
    if (isLoading) {
      this.setAttribute('loading', 'true');
      this.resetButton.classList.add(this.states.LOADING);
    } else {
      this.removeAttribute('loading');
      this.resetButton.classList.remove(this.states.LOADING);
      this.setAttribute('results', 'true');
    }
  }
}
customElements.define('predictive-search', PredictiveSearch);
