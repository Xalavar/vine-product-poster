// ==UserScript==
// @name         Vine Discord Poster
// @namespace    https://github.com/Xalavar
// @version      1.7
// @description  A tool to make posting to Discord easier
// @author       lelouch_di_britannia (Discord)
// @match        https://www.amazon.com/vine/vine-items*
// @match        https://www.amazon.co.uk/vine/vine-items*
// @match        https://www.amazon.ca/vine/vine-items*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=amazon.com
// @updateURL    https://raw.githubusercontent.com/xalavar/vine-product-sharing/main/brenda-product-share.user.js
// @downloadURL  https://raw.githubusercontent.com/xalavar/vine-product-sharing/main/brenda-product-share.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

/*

NOTES:
* Your API token is tied to your Discord username.

*/

(function() {
    'use strict';

    // Part of the migration process; will remove after a few months to ensure any remaining users have fully moved over
    try {
        var gmData = GM_getValue("config");
        if (gmData) {
            localStorage.setItem("VDP_HISTORY", JSON.stringify(gmData));
            GM_deleteValue("config");
        }
        var gmToken = GM_getValue("apiToken");
        if (gmToken) {
            localStorage.setItem("VDP_API_TOKEN", gmToken);
            GM_deleteValue("apiToken");
        }
    } catch(e) {
        console.log(e);
    }

    // initializing various localStorage items
    (JSON.parse(localStorage.getItem("VDP_HISTORY"))) ? JSON.parse(localStorage.getItem("VDP_HISTORY")) : localStorage.setItem("VDP_HISTORY", JSON.stringify({}));
    (localStorage.getItem("VDP_COOLDOWN")) ? localStorage.getItem("VDP_COOLDOWN") : localStorage.setItem("VDP_COOLDOWN", 0);
    var API_TOKEN = localStorage.getItem("VDP_API_TOKEN");

    function addGlobalStyle(css) {
        var head, style;
        head = document.getElementsByTagName('head')[0];
        if (!head) {
            return;
        }
        style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        head.appendChild(style);
    }

    addGlobalStyle(`.a-button-discord > .a-button-text { padding-left: 6px; }`);
    addGlobalStyle(`.a-button-discord-icon { background-image: url(https://m.media-amazon.com/images/S/sash/Gt1fHP07TsoILq3.png); content: ""; padding: 10px 10px 10px 10px; background-size: 512px 512px; background-repeat: no-repeat; margin-left: 10px; vertical-align: middle; }`);
    addGlobalStyle(`.a-button-discord.mobile-vertical { margin-top: 7px; margin-left: 0px; }`);

    const urlData = window.location.href.match(/(?!.*search)(amazon\..+)\/vine\/vine-items(?:\?queue=)?(encore|last_chance|potluck)?.*$/); // Country and queue type are extrapolated from this
    const MAX_COMMENT_LENGTH = 900;
    const ITEM_EXPIRY = 7776000000; // 90 days in ms
    const API_RATE_LIMIT = 10000;
    const PRODUCT_IMAGE_ID = /.+\/(.*)\._SS[0-9]+_\.[a-z]{3,4}$/;

    // Icons for the Share button
    const btn_discordSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -15 130 130" style="height: 29px; padding: 4px 0px 4px 10px;">
        <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" style="fill: #5865f2;"></path>
    </svg>`;
    const btn_loadingAnim = `<span class="a-spinner a-spinner-small" style="margin-left: 10px;"></span>`;
    const btn_checkmark = `<span class='a-button-discord-icon a-button-discord-success a-hires' style='background-position: -83px -116px;'></span>`;
    const btn_warning = `<span class='a-button-discord-icon a-button-discord-warning a-hires' style='background-position: -83px -96px;'></span>`;
    const btn_error = `<span class='a-button-discord-icon a-button-discord-error a-hires' style='background-position: -451px -422px;'></span>`;
    const btn_info = `<span class='a-button-discord-icon a-button-discord-info a-hires' style='background-position: -257px -354px;'></span>`;

    const errorMessages = document.querySelectorAll('#vvp-product-details-error-alert, #vvp-out-of-inventory-error-alert'); // modals pertaining to error messages

    // Removes old products if they've been in stored for 90+ days
    function purgeOldItems() {
        const items = JSON.parse(localStorage.getItem("VDP_HISTORY"));
        const date = new Date().getTime();

        for (const obj in items) {
            ((date - items[obj].date) >= ITEM_EXPIRY) ? delete items[obj] : null;
        }
        localStorage.setItem("VDP_HISTORY", JSON.stringify(items));

    }

    purgeOldItems();

    // Comment gets truncated by its lists, since the lengths of those are unknown, and we'll just say how many more there are at the end
    function truncateString(originalString) {
        var arr = originalString.split('\n');
        var tooLong = true;
        var variantsRemoved = {};
        var variantQuantities = {};
        var truncatedString = '';
        var count = 0;

        function compareItemLengths(y) {
            for (let x=0; x<arr.length; x++) {
                if (x !== y && variantQuantities[y] >= variantQuantities[x] ) {
                    return true;
                }
            }
        }

        while (tooLong) {

            if (count > 30) {
                tooLong = false; // in the rare likelihood that this will loop forever
            }

            for (let x=0; x<arr.length; x++) {
                var split = arr[x].split(' ● ');
                var fullArrayLength = arr.join('').length;
                if (split.length > 1 && !variantQuantities[x]) {
                    variantQuantities[x] = split.length;
                }

                if (split.length > 1 && fullArrayLength > MAX_COMMENT_LENGTH && compareItemLengths(x)) {
                    variantQuantities[x] = split.length - 1; // keep track of this index's array length
                    variantsRemoved[x] = (variantsRemoved.hasOwnProperty(x)) ? variantsRemoved[x]+1 : 1; // used for tracking the number of variants that were truncated
                    split.pop();
                    arr[x] = split.join(' ● ');
                    arr[x] += `** ... +${variantsRemoved[x]} more**`;
                } else if (fullArrayLength <= MAX_COMMENT_LENGTH) {
                    break;
                }
            }

            if (!(arr.join('\n').length > MAX_COMMENT_LENGTH)) {
                // the string is finally short enough to be sent over the API
                truncatedString = arr.join('\n');
                tooLong = false;
            }
            count++;
        }

        return truncatedString.trim();
    }

    function verifyToken(token) {
        return new Promise((resolve, reject) => {
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function() {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    console.log(xhr.status, xhr.responseText);
                    resolve(xhr);
                }
            };

            xhr.open("GET", `https://api.llamastories.com/brenda/user/${token}`, true);
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
            xhr.send();

        });
    }

    async function askForToken(reason) {
        return new Promise(async (resolve, reject) => {
            var userInput = prompt(`Your API token is ${reason}. Please enter a valid token:`);

            if (userInput !== null) {
                try {
                    var response = await verifyToken(userInput);
                    if (response && response.status === 200) {
                        // Save token after validation
                        localStorage.setItem("VDP_API_TOKEN", userInput);
                        resolve(userInput);
                    } else if (response && response.status === 404) {
                        alert("API token is invalid!");
                        reject("Invalid API token");
                    } else {
                        alert("API token authorization failed. Please try again later.");
                        console.log(`${response}`);
                        reject("Authorization failed");
                    }
                } catch (error) {
                    console.error("Error verifying API token:", error);
                    reject(error);
                }
            } else {
                reject("Error: User closed the prompt. A valid API token is required.");
            }
        });
    }

    function returnVariations() {
        var variations = {};

        document.querySelectorAll(`#vvp-product-details-modal--variations-container .vvp-variation-dropdown`).forEach(function(elem) {

            const type = elem.querySelector('h5').innerText;
            const names = Array.from(elem.querySelectorAll('.a-dropdown-container select option')).map(function(option) {
                return option.innerText.replace(/[*_~|`]/g, '\\$&');
            });
            variations[type] = names;
        });
        return variations;
    }

    function variationFormatting(variations) {
        var str = (Object.keys(variations).length > 1) ? '<:dropdown_options:1117467480860922018> Dropdowns' : '<:dropdown_options:1117467480860922018> Dropdown';
        for (const type in variations) {
            const t = (variations[type].length > 1) ? `\n**${type.replace(/(y$)/, 'ie')}s (${variations[type].length}):** ` : `\n**${type}:** `; // plural, if multiple
            str += t + variations[type].join(' ● ');
        }
        return str;
    }

    function noteFormatting(notes) {
        var str = (notes.length > 1) ? ':notepad_spiral: Notes' : ':notepad_spiral: Note';
        for (const item of notes) {
            (item != null) ? str += `\n* ${item}` : null;
        }
        return str;
    }

    // Checks if each dropdown has more than 1 option
    // Useful for pointing out misleading parent products
    function countVariations(obj) {
        for (const key in obj) {
            if (Array.isArray(obj[key]) && obj[key].length > 1) {
                return false; // If there are multiple variations, then we're better off not alerting anyone
            }
        }
        return true;
    }

    function writeComment(productData) {

        var hasNoSiblings = countVariations(productData.variations);

        var comment = [];
        (productData.seller) ? comment.push(`Seller: ${productData.seller}`) : null;
        (productData.isLimited) ? comment.push("<:limited_ltd:1117538207362457611> Limited") : null;
        (productData.variations) ? comment.push(variationFormatting(productData.variations)) : null;

        var notes = [];
        // different image urls
        (productData.differentImages && hasNoSiblings) ? notes.push("Parent product photo might not reflect available child variant.") : null;

        notes = notes.filter(value => value !== null);
        (notes.length > 0) ? comment.push(noteFormatting(notes)) : null;

        // Apply comment truncation, if necessary
        if (comment.length > MAX_COMMENT_LENGTH) {
            comment = truncateString(comment);
        }

        comment = comment.join('\n');

        return comment;
    }

    // Triggers when the Discord button is clicked
    async function buttonHandler() {

        // Prepping data to be sent to the API
        var productData = {};
        var childAsin = document.querySelector("a#vvp-product-details-modal--product-title").href.match(/amazon..+\/dp\/([A-Z0-9]+).*$/)[1];
        var childImage = document.querySelector('#vvp-product-details-img-container > img');

        var variations = returnVariations();
        productData.variations = (Object.keys(variations).length > 0) ? variations : null;
        productData.isLimited = (document.querySelector('#vvp-product-details-modal--limited-quantity').style.display !== 'none') ? true : false;
        productData.asin = parentAsin;
        productData.differentChild = (parentAsin !== childAsin) ? true : false; // comparing the asin loaded in the modal to the one on the webpage
        productData.differentImages = (parentImage !== childImage.src?.match(PRODUCT_IMAGE_ID)[1]) ? true : false;
        productData.etv = document.querySelector("#vvp-product-details-modal--tax-value-string")?.innerText.replace("$", "");
        productData.queue = queueType;
        productData.seller = document.querySelector("#vvp-product-details-modal--by-line").innerText.replace(/^by /, '');
        // possibly more things to come...

        // Compile everything miscellaneous into a comment string
        productData.comments = writeComment(productData);

        const response = await sendDataToAPI(productData);

        var listOfItems = JSON.parse(localStorage.getItem("VDP_HISTORY"));

        if (response) {
            // deal with the API response
            if (response.status == 200) { // successfully posted to Discord
                listOfItems[productData.asin] = {};
                listOfItems[productData.asin].status = 'Posted';
                listOfItems[productData.asin].queue = productData.queue;
                listOfItems[productData.asin].date = new Date().getTime();
                localStorage.setItem("VDP_HISTORY", JSON.stringify(listOfItems));
                setButtonState(2);
                localStorage.setItem("VDP_COOLDOWN", listOfItems[productData.asin].date);
            } else if (response.status == 400 || response.status == 401) { // invalid token
                setButtonState(5);
                // Will prompt the user to enter a valid token
                askForToken("missing/invalid").then((value) => {
                    API_TOKEN = value;
                    buttonHandler(); // retry the API request
                }).catch((error) => {
                    console.error(error);
                });
            } else if (response.status == 422) { // incorrect parameters (API might have been updated) or posting is paused
                setButtonState(6);
            } else if (response.status == 429) { // too many requests
                setButtonState(3);
            }
        }

    }

    let productDetailsModal;

    // Update position of the button
    function updateButtonPosition() {
        const button = document.querySelector('.a-button-discord');
        const container = productDetailsModal;

        // check the size of the modal first before determining where the button goes
        if (container.offsetWidth < container.offsetHeight) {
            // the See Details modal is taller, so moving it toward the bottom
            button.classList.add('mobile-vertical');
            button.parentElement.appendChild(button);
        } else {
            // revert to the original button placement
            button.classList.remove('mobile-vertical');
            button.parentElement.prepend(button);
        }

        button.removeElement; // remove the old button
        button.addEventListener("click", buttonHandler);
    }

    // Distinguishes the correct modal since Amazon doesn't distinguish them at all
    function getCorrectModal() {
        var btnHeaders = document.querySelectorAll('.vvp-modal-footer');
        var filteredHeaders = Array.from(btnHeaders).map(function (modal) {
            var productDetailsHeader = modal.parentElement.parentElement.querySelector('.a-popover-header > .a-popover-header-content');
            if (productDetailsHeader && productDetailsHeader.innerText.trim() === 'Product Details') {
                return [modal, modal.parentElement.parentElement];
            }
            return null;
        });

        filteredHeaders = filteredHeaders.filter(function (item) {
            return item !== null;
        });

        return filteredHeaders[0];
    }

    // Initialize the button
    function addShareButton() {
        var discordBtn = `<button class="a-button-discord a-button" style="align-items: center;"></button>`;
        var modalElems = getCorrectModal(); // ensuring the button gets added to the correct modal
        modalElems[0].insertAdjacentHTML('afterbegin', discordBtn);
        productDetailsModal = modalElems[1];

        // Add observer to check if the modal gets resized
        const resizeObserver = new ResizeObserver(updateButtonPosition);
        resizeObserver.observe(productDetailsModal);

    }

    // Offers more transparency regarding how long the rate limit of the API is
    function addButtonTimer(button) {
        var storedTimestamp = localStorage.getItem('VDP_COOLDOWN');
        var currentTimestamp = Date.now();
        var timeDifference = currentTimestamp - storedTimestamp;
        var remainingTime = API_RATE_LIMIT - timeDifference;
        var duration = 1000;

        if (remainingTime <= 0) {
            setButtonState(0);
        } else {
            button.innerHTML = `${btn_warning}<span class="a-button-text">Cooldown (${Math.floor(remainingTime / 1000)}s)</span>`;
            button.style.cursor = 'no-drop';
            button.disabled = true;
            duration = (remainingTime < 1000) ? remainingTime : duration; // having the duration match the remaining time makes it more precise
            setTimeout(function() {
                addButtonTimer(button);
            }, duration);

        }
    }

    function setButtonState(type) {
        var discordBtn = document.querySelector('.a-button-discord');
        var cooldownTimer = () => {
            var timeDiff = Date.now() - localStorage.getItem('VDP_COOLDOWN');
            if (timeDiff < API_RATE_LIMIT) {
                return timeDiff;
            }
            return false;
        }

        // reset the button
        discordBtn.disabled = false;
        discordBtn.classList.remove('a-button-disabled');

        if (type == 0 && cooldownTimer()) { // default
            addButtonTimer(discordBtn);
        } else if (type == 0) {
            discordBtn.innerHTML = `${btn_discordSvg}<span class="a-button-text">Share on Discord</span>`;
            discordBtn.style.cursor = 'pointer';
        } else if (type == 1) { // submit button is clicked and waiting for API result
            discordBtn.innerHTML = `${btn_loadingAnim}<span class="a-button-text">Submitting...</span>`;
            discordBtn.disabled = true;
            discordBtn.style.cursor = 'no-drop';
        } else if (type == 2) { // API: success
            discordBtn.innerHTML = `${btn_checkmark}<span class="a-button-text">Done!</span>`;
            discordBtn.disabled = true;
            discordBtn.classList.add('a-button-disabled');
        } else if (type == 3) { // API: posting too quickly
            discordBtn.innerHTML = `${btn_warning}<span class="a-button-text">Sharing too quickly!</span>`;
            discordBtn.style.cursor = 'pointer';
        } else if (type == 4) { // Item was already posted to Discord
            discordBtn.innerHTML = `${btn_info}<span class="a-button-text">Already posted</span>`;
            discordBtn.disabled = true;
            discordBtn.classList.add('a-button-disabled');
            discordBtn.style.cursor = 'no-drop';
        } else if (type == 5) { // API: invalid token
            discordBtn.innerHTML = `${btn_error}<span class="a-button-text">Invalid token</span>`;
            discordBtn.disabled = true;
            discordBtn.classList.add('a-button-disabled');
            discordBtn.style.cursor = 'no-drop';
        } else if (type == 6) { // API: incorrect parameters
            discordBtn.innerHTML = `${btn_error}<span class="a-button-text">Something went wrong</span>`;
            discordBtn.style.cursor = 'pointer';
        }

    }

    function sendDataToAPI(data) {

        const formData = new URLSearchParams({
            version: 1,
            token: API_TOKEN,
            domain: urlData[1],
            tab: data.queue,
            asin: data.asin,
            etv: data.etv,
            comment: data.comments,
        });

        setButtonState(1);

        return new Promise((resolve, reject) => {
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function() {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    console.log(xhr.status, xhr.responseText);
                    resolve(xhr);
                }
            };

            xhr.open("PUT", "https://api.llamastories.com/brenda/product", true);
            xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
            xhr.send(formData);
        });
    }

    // Determining the queue type from the HTML dom
    function d_queueType(text) {
        switch (text) {
            case "VENDOR_TARGETED":
                return "potluck"; // RFY
            case "VENDOR_VINE_FOR_ALL":
                return "last_chance"; // AFA
            case "VINE_FOR_ALL":
                return "encore"; // AI
            default:
                return null;
        }

    }

    let parentAsin, parentImage, queueType;

    // As much as I hate this, this adds event listeners to all of the "See details" buttons
    document.querySelectorAll('.a-button-primary.vvp-details-btn > .a-button-inner > input').forEach(function(element) {
        element.addEventListener('click', function() {

            parentAsin = this.getAttribute('data-asin');
            parentImage = this.parentElement.parentElement.parentElement.querySelector('img').src.match(PRODUCT_IMAGE_ID)[1];
            queueType = urlData?.[2] || d_queueType(this.getAttribute('data-recommendation-type'));

            // silencing console errors; a null error is inevitable with this arrangement; I might fix this in the future
            try {
                document.querySelector("button.a-button-discord").style.display = 'none'; // hiding the button until the modal content loads
            } catch (error) {
            }
        });
    });

    window.addEventListener('load', function () {
        var target, observer, config;

        target = document.querySelector("a#vvp-product-details-modal--product-title");

        config = {
            characterData: false,
            attributes: true,
            childList: false,
            subtree: false
        };

        // Mutation observer fires every time the product title in the modal changes
        observer = new MutationObserver(function (mutations) {

            if (!document.querySelector('.a-button-discord')) {
                addShareButton();
            }

            document.querySelector("button.a-button-discord").style.display = 'inline-flex';

            // remove pre-existing event listener before creating a new one
            document.querySelector("button.a-button-discord")?.removeEventListener("click", buttonHandler);

            // making sure there aren't any errors in the modal
            var hasError = !Array.from(errorMessages).every(function(elem) {
                return elem.style.display === 'none';
            });
            var wasPosted = JSON.parse(localStorage.getItem("VDP_HISTORY"))[parentAsin]?.queue;
            var isModalHidden = (document.querySelector("a#vvp-product-details-modal--product-title").style.visibility === 'hidden') ? true : false;

            if (hasError || queueType == null) {
                // Hide the Share button
                document.querySelector("button.a-button-discord").style.display = 'none';
            } else if (wasPosted === queueType) {
                // Product was already posted from the same queue before
                setButtonState(4);
            } else if (!isModalHidden) {
                setButtonState(0);
                document.querySelector("button.a-button-discord").addEventListener("click", buttonHandler);
            }

        });

        try {
            observer.observe(target, config);
        } catch(error) {
            console.log('No items on the page.');
        }

    });

})();
