<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        ${kcSanitize(msg("errorTitle"))?no_esc}
    <#elseif section = "form">
        <div id="kc-error-message">
            <p class="instruction">${kcSanitize(message.summary)?no_esc}</p>
            <#if traceId??>
                <p class="instruction" id="traceId">${msg("traceIdSupportMessage", traceId)}</p>
            </#if>
            <p>
                <a id="backToLogin" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}" href="/__llmm/console-login">${msg("backToLogin")}</a>
            </p>
        </div>
    </#if>
</@layout.registrationLayout>
