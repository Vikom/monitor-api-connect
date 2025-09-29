class CartDrawer extends DrawerComponent {
  constructor() {
    super();
    window.FoxKitSections = FoxTheme.utils.getSectionId(this);
    this.onCartRefreshListener = this.onCartRefresh.bind(this);
    this.getSectionToRenderListener = this.getSectionToRender.bind(this);
  }

  get requiresBodyAppended() {
    return false;
  }

  get sectionId() {
    return this.getAttribute('data-section-id');
  }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener('cart:grouped-sections', this.getSectionToRenderListener);
    document.addEventListener('cart:refresh', this.onCartRefreshListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('cart:grouped-sections', this.getSectionToRenderListener);
    document.removeEventListener('cart:refresh', this.onCartRefreshListener);
  }

  getSectionToRender(event) {
    event.detail.sections.push(FoxTheme.utils.getSectionId(this));
  }

  show(focusElement = null, animate = true) {
    super.show(focusElement, animate);

    if (this.open && !Shopify.designMode) {
      FoxTheme.a11y.trapFocus(this, this.focusElement);
    }
  }

  async onCartRefresh(event) {
    const cartId = `CartDrawer-${this.sectionId}`;

    const cartElement = document.getElementById(cartId);
    if (!cartElement) return;

    try {
      const response = await fetch(`${FoxTheme.routes.root_url}?section_id=${this.sectionId}`);
      const responseText = await response.text();

      const parser = new DOMParser();
      const parsedHTML = parser.parseFromString(responseText, 'text/html');

      const newCartContent = parsedHTML.getElementById(cartId).innerHTML;
      cartElement.innerHTML = newCartContent;

      if (event.detail.open === true) {
        this.show();
      }
    } catch (error) {
      console.error('Error refreshing cart:', error);
    }
  }
}
customElements.define('cart-drawer', CartDrawer);
class CartItems extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('change', FoxTheme.utils.debounce(this.onChange.bind(this), 300));
    this.cartUpdateUnsubscriber = FoxTheme.pubsub.subscribe(
      FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate,
      this.onCartUpdate.bind(this)
    );

    this.cartItemProducts = this.querySelectorAll('.cart-item__product');
    this.cartItemQuantitys = this.querySelectorAll('.cart-item__quantity');

    const loadTemplateContent = (elements, parentSelector) => {
      elements.forEach((element) => {
        const template = element.querySelector('template');
        const templateContent = template && document.importNode(template.content, true);
        const parent = element.querySelector(parentSelector);

        if (parent && template && !parent.querySelector('.template-content')) {
          const contentWrapper = document.createElement('div');
          contentWrapper.classList.add('template-content');
          contentWrapper.appendChild(templateContent);
          parent.appendChild(contentWrapper);
        }
      });
    };

    const removeTemplateContent = (elements, parentSelector) => {
      elements.forEach((element) => {
        const parent = element.querySelector(parentSelector);
        const templateContent = parent?.querySelector('.template-content');

        if (templateContent) {
          parent.removeChild(templateContent);
        }
      });
    };

    const handleTabletMatch = () => {
      loadTemplateContent(this.cartItemProducts, '.cart-item__product--info');
      removeTemplateContent(this.cartItemQuantitys, '.cart-item__quantity-wrapper');
    };

    const handleTabletUnmatch = () => {
      removeTemplateContent(this.cartItemProducts, '.cart-item__product--info');
      loadTemplateContent(this.cartItemQuantitys, '.cart-item__quantity-wrapper');
    };

    const mqlTablet = window.matchMedia(FoxTheme.config.mediaQueryTablet);
    FoxTheme.config.mqlTablet = mqlTablet.matches;

    if (FoxTheme.config.mqlTablet) {
      handleTabletMatch();
    } else {
      handleTabletUnmatch();
    }

    mqlTablet.onchange = (event) => {
      if (event.matches) {
        handleTabletMatch();
      } else {
        FoxTheme.config.mqlTablet = false;
        handleTabletUnmatch();
      }
    };

    window.FoxKitSections = FoxTheme.utils.getSectionId(this);
  }

  cartUpdateUnsubscriber = undefined;

  disconnectedCallback() {
    if (this.cartUpdateUnsubscriber) {
      this.cartUpdateUnsubscriber();
    }
  }

  onChange(event) {
    this.updateQuantity(
      event.target.dataset.index,
      event.target.value,
      document.activeElement.getAttribute('name'),
      event.target
    );
  }

  onCartError(errors, target) {
    if (target) {
      this.updateQuantity(
        target.getAttribute('data-index'),
        target.defaultValue,
        document.activeElement.getAttribute('name'),
        target
      );
    } else {
      window.location.href = FoxTheme.routes.cart_url;
    }
    alert(errors);
  }

  onCartUpdate(event) {
    if (event.cart.errors) {
      this.onCartError(event.cart.errors, event.target);
      return;
    }

    const sectionId = FoxTheme.utils.getSectionId(this);
    const sectionToRender = new DOMParser().parseFromString(event.cart.sections[sectionId], 'text/html');

    const cartDrawer = document.querySelector(`#CartDrawer-${sectionId}`);
    const cartDrawerBody = document.querySelector(`#CartDrawerBody-${sectionId}`);
    const cartDrawerFooter = document.querySelector(`#CartDrawerFooter-${sectionId}`);
    const cartDrawerEmpty = document.querySelector(`#CartDrawerEmpty-${sectionId}`);
    if (cartDrawer) {
      const cartDrawerBodyUpdate = sectionToRender.querySelector(`#CartDrawerBody-${sectionId}`);
      const cartDrawerFooterUpdate = sectionToRender.querySelector(`#CartDrawerFooter-${sectionId}`);
      const cartDrawerEmptyUpdate = sectionToRender.querySelector(`#CartDrawerEmpty-${sectionId}`);

      if (cartDrawerBodyUpdate) {
        cartDrawerBody.innerHTML = cartDrawerBodyUpdate.innerHTML;
      }
      if (cartDrawerFooterUpdate) {
        cartDrawerFooter.innerHTML = cartDrawerFooterUpdate.innerHTML;
      }

      if (cartDrawerEmptyUpdate) {
        cartDrawerEmpty.innerHTML = cartDrawerEmptyUpdate.innerHTML;
      }

      if (event.cart.item_count > 0) {
        cartDrawerBody.classList.remove('hidden');
        cartDrawerFooter.classList.remove('hidden');
        cartDrawerEmpty.classList.add('hidden');
      } else {
        cartDrawerBody.classList.add('hidden');
        cartDrawerFooter.classList.add('hidden');
        cartDrawerEmpty.classList.remove('hidden');
      }
    }

    const mainCart = document.querySelector(`#MainCart-${sectionId}`);
    if (mainCart) {
      const updatedElement = sectionToRender.querySelector(`#MainCart-${sectionId}`);
      if (updatedElement) {
        mainCart.innerHTML = updatedElement.innerHTML;
        if (event.cart.item_count > 0) {
          mainCart.closest('.cart').classList.remove('is-empty');
        } else {
          mainCart.closest('.cart').classList.add('is-empty');
        }
      } else {
        mainCart.closest('.cart').classList.add('is-empty');
        mainCart.remove();
      }
    }

    const lineItem =
      document.getElementById(`CartItem-${event.line}`) || document.getElementById(`CartDrawer-Item-${event.line}`);

    if (lineItem && lineItem.querySelector(`[name="${event.name}"]`)) {
      FoxTheme.a11y.trapFocus(mainCart || cartDrawer, lineItem.querySelector(`[name="${event.name}"]`));
    } else if (event.cart.item_count === 0) {
      cartDrawer
        ? FoxTheme.a11y.trapFocus(cartDrawer, cartDrawer.querySelector('a'))
        : FoxTheme.a11y.trapFocus(document.querySelector('.cart__empty'), document.querySelector('a'));
    } else {
      cartDrawer
        ? FoxTheme.a11y.trapFocus(cartDrawer, cartDrawer.querySelector('.cart-item__title'))
        : FoxTheme.a11y.trapFocus(mainCart, mainCart.querySelector('.cart-item__title'));
    }

    document.dispatchEvent(
      new CustomEvent('cart:updated', {
        detail: {
          cart: event.cart,
        },
      })
    );
  }

  updateQuantity(line, quantity, name, target) {
    this.showLoader(line);

    let sectionsToBundle = [];
    document.documentElement.dispatchEvent(
      new CustomEvent('cart:grouped-sections', { bubbles: true, detail: { sections: sectionsToBundle } })
    );

    // Handle decimal quantities - convert to integer for Shopify API
    let apiQuantity = quantity;
    const isDecimalInput = target && target.dataset.decimal === 'true';
    
    if (isDecimalInput) {
      // Parse Swedish decimal format and convert to integer by multiplying by 20 (for 0.05 steps)
      const decimalValue = typeof quantity === 'string' ? 
        parseFloat(quantity.replace(',', '.')) : 
        parseFloat(quantity);
      apiQuantity = Math.round(decimalValue * 20);
      console.log('🛒 Converting decimal quantity for API:', quantity, '→', apiQuantity);
    }

    const body = JSON.stringify({
      line,
      quantity: apiQuantity,
      sections: sectionsToBundle,
    });

    fetch(`${FoxTheme.routes.cart_change_url}`, { ...FoxTheme.utils.fetchConfig(), ...{ body } })
      .then((response) => response.json())
      .then((parsedState) => {
        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: parsedState, target, line, name });
      })
      .catch((error) => {
        console.log(error);
      });
  }

  showLoader(line) {
    const sectionId = FoxTheme.utils.getSectionId(this);
    const loaders = document.querySelectorAll(`#Loader-${sectionId}-${line}`);
    if (loaders) {
      loaders.forEach((loader) => {
        loader.classList.add('btn--loading');
      });
    }
  }
}

customElements.define('cart-items', CartItems);

class CartRemoveItem extends HTMLAnchorElement {
  constructor() {
    super();

    this.addEventListener('click', (event) => {
      event.preventDefault();

      const cartItems = this.closest('cart-items');
      cartItems.updateQuantity(this.dataset.index, 0);
    });
  }
}
customElements.define('cart-remove-item', CartRemoveItem, { extends: 'a' });
class CartNote extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('change', FoxTheme.utils.debounce(this.onChange.bind(this), 300));

    if (this.button && this.cartNoteDetailsSummary) {
      this.button.addEventListener('click', () => {
        this.cartNoteDetailsSummary.close();
      });
    }
  }

  get cartNoteDetailsSummary() {
    return this.closest('[is="accordion-details"]');
  }

  get button() {
    return this.querySelector('[type="button"]');
  }

  onChange(event) {
    const body = JSON.stringify({ note: event.target.value });
    fetch(`${FoxTheme.routes.cart_update_url}`, { ...FoxTheme.utils.fetchConfig(), ...{ body } });
  }
}
customElements.define('cart-note', CartNote);

class CalculateShipping extends ModalComponent {
  constructor() {
    super();
    this.countryProvince = this.querySelector('country-province');
    this.isCountrySetup = false;
  }
  static get observedAttributes() {
    return [...super.observedAttributes, 'data-show'];
  }
  show() {
    super.show();
    this.setAttribute('data-show', true);
  }

  hide() {
    super.hide();
    this.setAttribute('data-show', false);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === 'data-show' && newValue === 'true' && !this.isCountrySetup && this.countryProvince) {
      const template = this.countryProvince.querySelector('template');
      const templateContent = document.importNode(template.content, true);
      this.countryProvince.countryElement.appendChild(templateContent);
      this.countryProvince.init();
      this.isCountrySetup = true;
    }
  }
}
customElements.define('calculate-shipping', CalculateShipping);
class CountryProvinceForm extends HTMLElement {
  constructor() {
    super();
    this.provinceElement = this.querySelector('[name="address[province]"]');
    this.countryElement = this.querySelector('[name="address[country]"]');
    this.template = this.dataset.template;
    this.countryElement.addEventListener('change', this.handleCountryChange.bind(this));
    if (this.template && this.template === 'cart') {
      this.init();
    }
  }

  init() {
    if (this.getAttribute('country') !== '') {
      this.countryElement.selectedIndex = Math.max(
        0,
        Array.from(this.countryElement.options).findIndex((option) => option.textContent === this.dataset.country)
      );
      this.countryElement.dispatchEvent(new Event('change'));
    } else {
      this.handleCountryChange();
    }
  }

  handleCountryChange() {
    const option = this.countryElement.options[this.countryElement.selectedIndex],
      provinces = JSON.parse(option.dataset.provinces);

    this.provinceElement.closest('.form-field').hidden = provinces.length === 0;

    if (provinces.length === 0) {
      return;
    }

    this.provinceElement.innerHTML = '';

    provinces.forEach((data) => {
      const selected = data[1] === this.dataset.province;
      this.provinceElement.options.add(new Option(data[1], data[0], selected, selected));
    });
  }
}
customElements.define('country-province', CountryProvinceForm);

class ShippingCalculator extends HTMLFormElement {
  constructor() {
    super();

    this.submitButton = this.querySelector('[type="submit"]');
    this.resultsElement = this.lastElementChild;

    this.submitButton.addEventListener('click', this.handleFormSubmit.bind(this));
  }

  handleFormSubmit(event) {
    event.preventDefault();

    const zip = this.querySelector('[name="address[zip]"]').value,
      country = this.querySelector('[name="address[country]"]').value,
      province = this.querySelector('[name="address[province]"]').value;

    this.submitButton.classList.add('btn--loading');

    const body = JSON.stringify({
      shipping_address: { zip, country, province },
    });
    let sectionUrl = `${FoxTheme.routes.cart_url}/shipping_rates.json`;

    sectionUrl = sectionUrl.replace('//', '/');

    fetch(sectionUrl, { ...FoxTheme.utils.fetchConfig('javascript'), ...{ body } })
      .then((response) => response.json())
      .then((parsedState) => {
        if (parsedState.shipping_rates) {
          this.formatShippingRates(parsedState.shipping_rates);
        } else {
          this.formatError(parsedState);
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        this.resultsElement.hidden = false;
        this.submitButton.classList.remove('btn--loading');
      });
  }

  formatError(errors) {
    const shippingRatesList = Object.keys(errors).map((errorKey) => {
      return `<li>${errors[errorKey]}</li>`;
    });
    this.resultsElement.innerHTML = `
      <div class="alert alert--error blocks-radius grid gap-2">
        <p class="font-body-bolder m-0">${FoxTheme.shippingCalculatorStrings.error}</p>
        <ul class="list-disc grid gap-1 text-sm" role="list">${shippingRatesList.join('')}</ul>
      </div>
    `;
  }

  formatShippingRates(shippingRates) {
    const shippingRatesList = shippingRates.map(({ presentment_name, currency, price }) => {
      return `<li>${presentment_name}: ${currency} ${price}</li>`;
    });
    this.resultsElement.innerHTML = `
      <div class="alert blocks-radius alert--${
        shippingRates.length === 0 ? 'error' : 'success'
      } grid gap-2 leading-tight">
        <p class="font-body-bolder m-0">${
          shippingRates.length === 0
            ? FoxTheme.shippingCalculatorStrings.notFound
            : shippingRates.length === 1
            ? FoxTheme.shippingCalculatorStrings.oneResult
            : FoxTheme.shippingCalculatorStrings.multipleResults
        }</p>
        ${
          shippingRatesList === ''
            ? ''
            : `<ul class="list-disc grid gap-1 text-sm" role="list">${shippingRatesList.join('')}</ul>`
        }
      </div>
    `;
  }
}
customElements.define('shipping-calculator', ShippingCalculator, { extends: 'form' });

class CartDrawerProductsRecommendation extends HTMLElement {
  constructor() {
    super();
    this.carousel = null;
    this.isLoading = false;

    this.classes = {
      grid: 'f-grid',
      swiper: 'swiper',
      swiperWrapper: 'swiper-wrapper',
      loading: 'is-loading',
    };

    // Handle Safari separately
    const isSafari = navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome');
    if (isSafari) {
      this.init();
    } else {
      FoxTheme.Motion.inView(this, this.init.bind(this), { margin: '600px 0px 600px 0px' });
    }
  }

  disconnectedCallback() {
    // Cleanup
    this.destroyCarousel();
    const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
    mql.removeEventListener('change', this.handleCarousel.bind(this));
  }

  init() {
    if (this.isLoading || !this.dataset.url) return;

    this.isLoading = true;
    this.classList.add(this.classes.loading);

    fetch(this.dataset.url)
      .then((response) => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.text();
      })
      .then((responseText) => {
        const sectionInnerHTML = new DOMParser()
          .parseFromString(responseText, 'text/html')
          .querySelector('.shopify-section');

        if (!sectionInnerHTML) return;

        const recommendations = sectionInnerHTML.querySelector('cart-drawer-products-recommendation');
        if (recommendations?.innerHTML.trim().length) {
          this.innerHTML = recommendations.innerHTML;
          const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
          mql.addEventListener('change', this.handleCarousel.bind(this));
          this.handleCarousel();
          this.dispatchEvent(new CustomEvent('recommendations:loaded'));
        } else {
          this.closest('.shopify-section')?.remove();
        }
      })
      .catch((error) => {
        console.error('Error loading recommendations:', error);
        this.classList.add('has-error');
      })
      .finally(() => {
        this.isLoading = false;
        this.classList.remove(this.classes.loading);
      });
  }

  initCarousel() {
    if (!this.wrapper?.innerHTML.trim().length) {
      this.classList.add('hidden');
      return;
    }

    try {
      this.container.classList.add(this.classes.swiper);
      this.wrapper.classList.remove(this.classes.grid);
      this.wrapper.classList.add(this.classes.swiperWrapper);

      this.carousel = new FoxTheme.Carousel(this.slideContainer, {
        slidesPerView: 3,
        spaceBetween: 10,
        loop: false,
        navigation: {
          nextEl: this.sliderNext,
          prevEl: this.sliderPrev,
        },
      });

      if (this.carousel) {
        this.carousel.init();
        this.calcNavButtonsPosition();
      }
    } catch (error) {
      console.error('Error initializing carousel:', error);
      this.destroyCarousel();
    }
  }

  handleCarousel() {
    if (FoxTheme.config.mqlMobile) {
      this.destroyCarousel();
    } else {
      this.initCarousel();
    }
  }

  destroyCarousel() {
    if (!this.wrapper?.innerHTML.trim().length) {
      this.classList.add('hidden');
      return;
    }
    this.container?.classList.remove(this.classes.swiper);
    this.wrapper?.classList.remove(this.classes.swiperWrapper);
    this.wrapper?.classList.add(this.classes.grid);

    // Only try to destroy if carousel exists and is an object
    if (this.carousel && typeof this.carousel === 'object' && this.carousel.slider) {
      this.carousel.slider.destroy();
      this.carousel = null;
    }
  }

  calcNavButtonsPosition() {
    if (!this.dataset.calcButtonPosition === 'true') return;
    const firstMedia = this.querySelector('.product-card__image-wrapper');
    if (firstMedia && firstMedia.clientHeight > 0) {
      this.style.setProperty('--swiper-navigation-top-offset', parseInt(firstMedia.clientHeight) / 2 + 'px');
    }
  }

  get slideContainer() {
    return this.querySelector('.swiper');
  }

  get sliderPagination() {
    return this.querySelector('.swiper-pagination');
  }

  get sliderNext() {
    return this.querySelector('.swiper-button-next');
  }

  get sliderPrev() {
    return this.querySelector('.swiper-button-prev');
  }

  get container() {
    return this.querySelector('.cart-drawer-products-recommendation__container');
  }

  get wrapper() {
    return this.querySelector('.cart-drawer-products-recommendation__wrapper');
  }
}

customElements.define('cart-drawer-products-recommendation', CartDrawerProductsRecommendation);

class MainCart extends HTMLElement {
  constructor() {
    super();

    document.addEventListener('cart:grouped-sections', this.getSectionToRender.bind(this));
  }

  getSectionToRender(event) {
    event.detail.sections.push(FoxTheme.utils.getSectionId(this));
  }
}
customElements.define('main-cart', MainCart);

class FreeShippingGoal extends HTMLElement {
  constructor() {
    super();
    this.selectors = {
      leftToSpend: '[data-left-to-spend]',
    };
    this.goal = Number(this.dataset.minimumAmount) * Number(window.Shopify.currency.rate || 1) || 0;
    this.progress = this.querySelector('progress-bar');
    this.money_format = window.FoxTheme.settings.moneyFormat;
  }

  connectedCallback() {
    this.updateShippingGloal(Number(this.dataset.cartTotal));
    document.addEventListener('cart:updated', (event) => {
      this.updateShippingGloal(event.detail.cart.items_subtotal_price);
    });
  }

  updateShippingGloal(amount) {
    if (amount > 0) {
      this.classList.remove('hidden');
    } else {
      this.classList.add('hidden');
    }

    this.cartTotal = amount / 100;
    this.goalLeft = this.goal - this.cartTotal;
    this.goalDone = this.goalLeft <= 0;

    this.percent = (this.cartTotal * 100) / this.goal;

    if (this.percent >= 100) this.percent = 100;

    if (this.cartTotal >= this.goal) {
      this.progress.style.setProperty('--percent', `${this.percent}%`);
      this.classList.add('free-shipping-goal--done');
      this.progress.dataset.value = this.cartTotal;
      this.progress.dataset.max = this.goal;
    } else {
      let spend = (this.goal - this.cartTotal) * 100;
      this.querySelector(this.selectors.leftToSpend).innerHTML = FoxTheme.Currency.formatMoney(
        spend,
        this.money_format
      );
      this.classList.remove('free-shipping-goal--done');
      this.progress.style.setProperty('--percent', `${this.percent}%`);
      this.progress.dataset.value = this.cartTotal;
      this.progress.dataset.max = this.goal;
    }
  }
}
customElements.define('free-shipping-goal', FreeShippingGoal);

window.FoxKitAddToCart = async (payload) => {
  if (!payload?.properties?.['_FoxKit offer']) return;

  const cartJson = await (
    await fetch(`${FoxTheme.routes.cart_url}`, {
      ...FoxTheme.utils.fetchConfig(),
    })
  ).json();
  cartJson['sections'] = payload['sections'];
  FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: cartJson });

  document.dispatchEvent(
    new CustomEvent('product-ajax:added', {
      detail: {
        product: payload,
      },
    })
  );
};
