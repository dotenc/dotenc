// ===== Copy to Clipboard =====
document.querySelectorAll(".copy-btn").forEach((btn) => {
	btn.addEventListener("click", async () => {
		const text = btn.dataset.copy
		if (!text) return

		try {
			await navigator.clipboard.writeText(text)
			btn.classList.add("copied")

			const svg = btn.querySelector("svg")
			const originalIcon = [...svg.childNodes]
			const checkmark = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"path",
			)
			checkmark.setAttribute("stroke-linecap", "round")
			checkmark.setAttribute("stroke-linejoin", "round")
			checkmark.setAttribute("stroke-width", "2")
			checkmark.setAttribute("d", "M5 13l4 4L19 7")
			svg.replaceChildren(checkmark)

			setTimeout(() => {
				btn.classList.remove("copied")
				svg.replaceChildren(...originalIcon)
			}, 2000)
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement("textarea")
			textarea.value = text
			textarea.className = "fixed fade-in-up"
			document.body.appendChild(textarea)
			textarea.select()
			document.execCommand("copy")
			document.body.removeChild(textarea)
		}
	})
})

// ===== Mobile Nav Toggle =====
const menuBtn = document.getElementById("mobile-menu-btn")
const mobileNav = document.getElementById("mobile-nav")

if (menuBtn && mobileNav) {
	menuBtn.addEventListener("click", () => {
		mobileNav.classList.toggle("open")
	})

	// Close mobile nav when clicking a link
	mobileNav.querySelectorAll(".mobile-nav-link").forEach((link) => {
		link.addEventListener("click", () => {
			mobileNav.classList.remove("open")
		})
	})

	// Close on outside click
	document.addEventListener("click", (e) => {
		if (!mobileNav.contains(e.target) && !menuBtn.contains(e.target)) {
			mobileNav.classList.remove("open")
		}
	})
}

// ===== Scroll Animations (staggered) =====
const observer = new IntersectionObserver(
	(entries) => {
		let delay = 0
		for (const entry of entries) {
			if (entry.isIntersecting) {
				setTimeout(() => entry.target.classList.add("visible"), delay)
				delay += 80
				observer.unobserve(entry.target)
			}
		}
	},
	{ threshold: 0.1 },
)

document.querySelectorAll(".fade-in-up").forEach((el) => {
	observer.observe(el)
})

// ===== Install Tabs =====
const tabs = document.querySelectorAll(".install-tab")
const contents = document.querySelectorAll(".install-content")

tabs.forEach((tab) => {
	tab.addEventListener("click", () => {
		const target = tab.dataset.tab

		// Update tab states
		tabs.forEach((t) => {
			t.classList.remove("active")
			t.classList.add("text-cyber-muted")
		})
		tab.classList.add("active")
		tab.classList.remove("text-cyber-muted")

		// Show target content, hide others
		contents.forEach((content) => {
			if (content.id === `tab-${target}`) {
				content.classList.remove("hidden")
			} else {
				content.classList.add("hidden")
			}
		})
	})
})

// ===== Active Nav Highlight =====
const sections = document.querySelectorAll("section[id]")
const navLinks = document.querySelectorAll('nav a[href^="#"]')

window.addEventListener(
	"scroll",
	() => {
		let current = ""
		const atBottom =
			window.innerHeight + window.scrollY >= document.body.offsetHeight - 50
		if (atBottom && sections.length) {
			current = sections[sections.length - 1].getAttribute("id")
		} else {
			for (const section of sections) {
				const top = section.offsetTop - 100
				if (scrollY >= top) {
					current = section.getAttribute("id")
				}
			}
		}

		navLinks.forEach((link) => {
			link.classList.remove("text-cyber-cyan")
			if (!link.classList.contains("text-cyber-cyan")) {
				link.classList.add("text-cyber-muted")
			}
			if (current && link.getAttribute("href") === `#${current}`) {
				link.classList.remove("text-cyber-muted")
				link.classList.add("text-cyber-cyan")
			}
		})
	},
	{ passive: true },
)
