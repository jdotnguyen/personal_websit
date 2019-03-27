/* When document is loaded */
$(document).ready(function() {
	/* Initial smooth scroll down */
	$('.landing_section_header_down_arrow').click(function() {
		$('html, body').animate({
			scrollTop: $('.about_section').offset().top
		}, 800);
	});

	/* Back to the top */
	$('.footer_subsection_brand').click(function (e) {
		e.preventDefault();
		$('html, body').animate({
			scrollTop: 0
		}, 800);
	});
});